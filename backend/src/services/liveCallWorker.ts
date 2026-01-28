import twilio from "twilio";
import { prisma } from "../prisma";
import { isWithinCallWindow } from "../timeWindow";
import { DEFAULT_LIVE_TWIML } from "../twilioVoice";
import { BatchState } from "@prisma/client";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Rate limiting configuration from environment variables
const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_CALLS || "1", 10);
const CALL_DELAY_MS = parseInt(process.env.CALL_DELAY_MS || "45000", 10);
const CALL_MODE = (process.env.CALL_MODE || "DRY_RUN").toUpperCase();

// Prevent parallel batches per campaign
const activeBatches = new Set<string>();

// Initialize Twilio client
function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER;
  
  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set');
  }
  
  if (!fromNumber) {
    throw new Error('TWILIO_PHONE_NUMBER or TWILIO_FROM_NUMBER not set');
  }
  
  return {
    client: twilio(accountSid, authToken),
    fromNumber,
  };
}

/**
 * Validates that a Twilio call creation payload has either twiml or url.
 * Throws an error if neither is provided (required for LIVE mode calls).
 * Do NOT rely on phone-number voice configuration.
 */
function validateCallMediaInstructions(callParams: { twiml?: string; url?: string; [key: string]: any }): void {
  if (!callParams.twiml && !callParams.url) {
    throw new Error(
      'Twilio call requires either "twiml" (inline TwiML) or "url" (TwiML endpoint). ' +
      'Phone-number voice configuration is not allowed. Provide explicit media instructions.'
    );
  }
  
  // Validate that if url is provided, it's a valid URL
  if (callParams.url && typeof callParams.url === 'string') {
    try {
      new URL(callParams.url);
    } catch {
      throw new Error(`Invalid TwiML URL provided: ${callParams.url}`);
    }
  }
}

function getTwilioVoiceUrlFromEnv(): string | null {
  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BASE_URL;
  if (!baseUrl) return null;
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/twilio/voice`;
}

function ensureCallMediaInstructions(
  callParams: { twiml?: string; url?: string; [key: string]: any },
  fallbackUrl?: string | null
): void {
  if (!callParams.twiml && !callParams.url && fallbackUrl) {
    callParams.url = fallbackUrl;
  }
  validateCallMediaInstructions(callParams);
}

function enforceProgrammableVoiceOnly(
  callParams: { to?: string; sipTrunk?: string; sipDomain?: string; [key: string]: any }
): void {
  const sipEnabled = process.env.ENABLE_SIP_TRUNKING === "true";
  if (CALL_MODE === "LIVE" && !sipEnabled) {
    const toValue = typeof callParams.to === "string" ? callParams.to : "";
    const looksLikeSip = toValue.toLowerCase().startsWith("sip:");
    if (looksLikeSip || callParams.sipTrunk || callParams.sipDomain) {
      throw new Error(
        "SIP Trunking is disabled. Enable via ENABLE_SIP_TRUNKING=true to use SIP; " +
          "otherwise only Programmable Voice with TwiML is allowed in LIVE mode."
      );
    }
  }
}

type TwilioCallParams = {
  to: string;
  from: string;
  twiml?: string;
  url?: string;
  [key: string]: any;
};

/**
 * Structured logging for Twilio outbound calls.
 */
function logTwilioCallBefore(params: {
  campaignId?: string;
  leadId?: string;
  to: string;
  callMode: string;
  hasTwiml: boolean;
  hasUrl: boolean;
}): void {
  const logData = {
    event: 'TWILIO_CALL_BEFORE',
    timestamp: new Date().toISOString(),
    campaignId: params.campaignId || null,
    leadId: params.leadId || null,
    to: params.to,
    callMode: params.callMode,
    mediaType: params.hasTwiml ? 'twiml' : (params.hasUrl ? 'url' : 'NONE'),
    hasMediaInstructions: params.hasTwiml || params.hasUrl,
  };
  
  if (!logData.hasMediaInstructions) {
    console.error('[TWILIO_CALL_BEFORE] ⚠️  WARNING: Call created WITHOUT TwiML/URL!', JSON.stringify(logData, null, 2));
  } else {
    console.log('[TWILIO_CALL_BEFORE]', JSON.stringify(logData, null, 2));
  }
}

function logTwilioCallAfter(params: {
  campaignId?: string;
  leadId?: string;
  callSid: string;
  callStatus: string;
}): void {
  const logData = {
    event: 'TWILIO_CALL_AFTER',
    timestamp: new Date().toISOString(),
    campaignId: params.campaignId || null,
    leadId: params.leadId || null,
    callSid: params.callSid,
    callStatus: params.callStatus,
  };
  
  console.log('[TWILIO_CALL_AFTER]', JSON.stringify(logData, null, 2));
}

function logTwilioCallError(params: {
  campaignId?: string;
  leadId?: string;
  to?: string;
  error: any;
}): void {
  const twilioError = params.error;
  const logData = {
    event: 'TWILIO_CALL_ERROR',
    timestamp: new Date().toISOString(),
    campaignId: params.campaignId || null,
    leadId: params.leadId || null,
    to: params.to || null,
    error: {
      message: twilioError?.message || String(twilioError),
      code: twilioError?.code || null,
      status: twilioError?.status || null,
      moreInfo: twilioError?.moreInfo || null,
      details: twilioError?.details || null,
      // Include full error object for debugging
      fullError: twilioError ? JSON.stringify(twilioError, Object.getOwnPropertyNames(twilioError)) : null,
    },
  };
  
  console.error('[TWILIO_CALL_ERROR]', JSON.stringify(logData, null, 2));
}

export async function startLiveCallWorker(campaignId: string): Promise<void> {
  // Batch State Safety: Ensure only ONE batch runs per campaign
  if (activeBatches.has(campaignId)) {
    console.log(`[BATCH] Campaign ${campaignId} already has an active batch, skipping`);
    return;
  }
  activeBatches.add(campaignId);

  try {
    console.log(`[BATCH START] Campaign ${campaignId}`);
    console.log(`[LIVE] Batch started ${campaignId}`);

    // Resume support: Only pick leads with callStatus = PENDING
    // Skips COMPLETED, FAILED, BUSY automatically via query filter
    const contacts = await prisma.campaignContact.findMany({
      where: { campaignId, callStatus: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        contact: { select: { phone: true } },
      },
    });
    
    if (contacts.length === 0) {
      console.log(`[BATCH RESUME] Campaign ${campaignId} - No PENDING leads found`);
    } else {
      console.log(`[BATCH RESUME] Campaign ${campaignId} - Found ${contacts.length} PENDING leads`);
    }

    if (contacts.length === 0) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { batchActive: false, batchState: BatchState.COMPLETED },
      });
      console.log(`[BATCH COMPLETE] Campaign ${campaignId} - State: RUNNING -> COMPLETED`);
      return;
    }

    // Get Twilio client
    let twilioClient: ReturnType<typeof getTwilioClient>;
    try {
      twilioClient = getTwilioClient();
    } catch (err: any) {
      console.error(`[TWILIO ERROR] Failed to initialize Twilio client: ${err.message}`);
      throw err;
    }

    // Rate limiting: Ensure sequential execution (MAX_CONCURRENT_CALLS = 1)
    // Process contacts one at a time
    for (const contact of contacts) {
      try {
        let campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: {
            batchActive: true,
            batchState: true,
            openingScript: true,
            tone: true,
            language: true,
          },
        });

        console.log(`[BATCH] State check: ${campaign?.batchState ?? "UNKNOWN"}`);

        if (!campaign?.batchActive || campaign.batchState === BatchState.STOPPED) {
          console.log(`[BATCH] Stopped campaign ${campaignId}`);
          break;
        }

        if (campaign.batchState === BatchState.COMPLETED) {
          console.log(`[BATCH COMPLETED] Campaign ${campaignId}`);
          break;
        }

        // Handle paused state
        while (campaign.batchState === BatchState.PAUSED) {
          console.log(`[BATCH PAUSED] Campaign ${campaignId}`);
          // Check call window while paused - if window opens, resume automatically
          if (isWithinCallWindow()) {
            console.log("[CALL WINDOW] Window opened, resuming batch");
            await prisma.campaign.update({
              where: { id: campaignId },
              data: { batchState: BatchState.RUNNING, batchActive: true },
            });
            console.log(`[BATCH TRANSITION] Campaign ${campaignId}: PAUSED -> RUNNING (call window opened)`);
            campaign.batchState = BatchState.RUNNING;
            break;
          }
          await sleep(2000);
          const refreshedCampaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { batchActive: true, batchState: true },
          });
          if (!refreshedCampaign?.batchActive || refreshedCampaign.batchState === BatchState.STOPPED) {
            console.log(`[BATCH] Stopped campaign ${campaignId}`);
            return;
          }
          if (refreshedCampaign.batchState === BatchState.COMPLETED) {
            console.log(`[BATCH COMPLETED] Campaign ${campaignId}`);
            return;
          }
          campaign.batchState = refreshedCampaign.batchState;
        }

        // Claim the lead atomically (prevents parallel calls)
        const claim = await prisma.campaignContact.updateMany({
          where: { id: contact.id, callStatus: "PENDING" },
          data: { callStatus: "IN_PROGRESS" },
        });

        if (claim.count === 0) {
          // Lead was already claimed or not in PENDING state, skip
          console.log(`[BATCH] Lead ${contact.id} already processed, skipping`);
          continue;
        }

        // Call Window Guard: Hard stop - Check BEFORE starting EACH call
        if (!isWithinCallWindow()) {
          console.log("[CALL WINDOW] Paused — outside calling hours");
          // Reset the lead back to PENDING since we didn't actually call
          await prisma.campaignContact.update({
            where: { id: contact.id },
            data: { callStatus: "PENDING" },
          });
          // Auto-pause the batch and persist state
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { batchState: BatchState.PAUSED, batchActive: true },
          });
          console.log(`[BATCH PAUSE] Campaign ${campaignId} - State: RUNNING -> PAUSED`);
          console.log(`[BATCH PAUSE] Campaign ${campaignId} - Reason: Outside call window`);
          break; // Hard stop - do NOT continue calls
        }

        const phoneNumber = contact.contact?.phone || "unknown";
        console.log(`[CALL START] Lead ${contact.id} - Phone: ${phoneNumber}`);
        console.log(`[TWILIO] Initiating call`);

        // Make REAL Twilio call
        let callSid: string;
        let callResult: "COMPLETED" | "NO_ANSWER" | "BUSY" | "FAILED" = "FAILED";
        let callDuration = 0;

        try {
          const callParams: TwilioCallParams = {
            to: phoneNumber,
            from: twilioClient.fromNumber,
            twiml: DEFAULT_LIVE_TWIML,
          };
          
          // Validate media instructions before creating call (required for LIVE mode)
          const fallbackUrl = getTwilioVoiceUrlFromEnv();
          ensureCallMediaInstructions(callParams, fallbackUrl);
          enforceProgrammableVoiceOnly(callParams);
          
          // Structured logging before call
          logTwilioCallBefore({
            campaignId: campaignId,
            leadId: contact.id,
            to: phoneNumber,
            callMode: CALL_MODE,
            hasTwiml: !!callParams.twiml,
            hasUrl: !!callParams.url,
          });
          
          const call = await twilioClient.client.calls.create(callParams);

          callSid = call.sid;
          
          // Structured logging after call
          logTwilioCallAfter({
            campaignId: campaignId,
            leadId: contact.id,
            callSid: call.sid,
            callStatus: call.status || 'unknown',
          });
          
          console.log(`[TWILIO] Call SID: ${callSid}`);

          // Wait for call to complete (simplified - in production you'd use webhooks)
          // For now, we'll mark it as completed after a short delay
          // In production, you should use Twilio webhooks to track actual call status
          await sleep(5000); // Wait 5 seconds for call to connect

          // Check call status via Twilio API
          const callStatus = await twilioClient.client.calls(callSid).fetch();
          
          if (callStatus.status === 'completed') {
            callResult = "COMPLETED";
            callDuration = callStatus.duration ? parseInt(callStatus.duration, 10) : 0;
          } else if (callStatus.status === 'no-answer' || callStatus.status === 'busy') {
            callResult = callStatus.status === 'no-answer' ? "NO_ANSWER" : "BUSY";
          } else {
            callResult = "FAILED";
          }

          console.log(`[CALL END] Lead ${contact.id} - Phone: ${phoneNumber} - Result: ${callResult}`);

        } catch (twilioError: any) {
          // Structured logging on error
          logTwilioCallError({
            campaignId: campaignId,
            leadId: contact.id,
            to: phoneNumber,
            error: twilioError,
          });
          
          console.error(`[TWILIO ERROR] Call failed for lead ${contact.id}:`, twilioError.message);
          callResult = "FAILED";
          callSid = "error";
          
          // Mark call as failed in database
          await prisma.campaignContact.update({
            where: { id: contact.id },
            data: { callStatus: "FAILED" },
          });
          
          // Continue to next lead instead of breaking the batch
          continue;
        }

        // Create call log entry
        const callLog = await prisma.callLog.create({
          data: {
            campaignContactId: contact.id,
            startedAt: new Date(),
            endedAt: new Date(),
            durationSeconds: callDuration || null,
            transcript: callResult === "COMPLETED" ? "Live call completed via Twilio" : null,
            aiSummary: `Twilio call result: ${callResult}`,
          },
        });

        // Update contact status
        await prisma.campaignContact.update({
          where: { id: contact.id },
          data: {
            callStatus: callResult === "COMPLETED" ? "COMPLETED" : "FAILED",
            lastCallAt: new Date(),
          },
        });

        // Rate limiting: Add delay after each call ends (before next call starts)
        if (CALL_DELAY_MS > 0) {
          console.log(`[RATE LIMIT] Waiting ${CALL_DELAY_MS / 1000}s before next call`);
          await sleep(CALL_DELAY_MS);
        }
      } catch (err) {
        console.error(`[LIVE] Contact processing failed (${contact.id})`, err);
        try {
          await prisma.campaignContact.update({
            where: { id: contact.id },
            data: { callStatus: "FAILED" },
          });
        } catch (updateErr) {
          console.error(`[LIVE] Failed to mark contact as FAILED (${contact.id})`, updateErr);
        }
      }
    }

    const [pendingCount, inProgressCount] = await Promise.all([
      prisma.campaignContact.count({
        where: { campaignId, callStatus: "PENDING" },
      }),
      prisma.campaignContact.count({
        where: { campaignId, callStatus: "IN_PROGRESS" },
      }),
    ]);

    const finalCampaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { batchState: true },
    });

    if (
      pendingCount === 0 &&
      inProgressCount === 0 &&
      finalCampaign?.batchState !== BatchState.STOPPED
    ) {
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { batchActive: false, batchState: BatchState.COMPLETED },
      });
      console.log(`[BATCH COMPLETE] Campaign ${campaignId} - State: RUNNING -> COMPLETED`);
    }
  } catch (err) {
    console.error(`[LIVE] Batch failed ${campaignId}`, err);
  } finally {
    // Always remove from active batches set
    activeBatches.delete(campaignId);
  }
}
