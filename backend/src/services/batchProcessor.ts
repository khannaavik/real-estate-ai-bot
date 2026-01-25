import { prisma } from "../prisma";
import { CallLifecycleStatus, CallStatus } from "@prisma/client";
import { analyzeCallOutcome, type CallStatus as AICallStatus } from "./aiCallAnalysis";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Rate limiting configuration from environment variables
const MAX_CONCURRENT_CALLS = parseInt(process.env.MAX_CONCURRENT_CALLS || "1", 10);
const CALL_DELAY_MS = parseInt(process.env.CALL_DELAY_MS || "45000", 10);

function randomBetween(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

async function startMockCall(leadId: string): Promise<{ callId: string; status: "PICKED" | "NO_ANSWER" }> {
  const campaignContact = await prisma.campaignContact.findUnique({
    where: { id: leadId },
    select: { id: true, campaignId: true },
  });

  if (!campaignContact) {
    throw new Error("Lead not found");
  }

  const call = await prisma.call.create({
    data: {
      campaignId: campaignContact.campaignId,
      leadId: campaignContact.id,
      status: CallLifecycleStatus.STARTED,
    },
  });

  const pickedUp = Math.random() < 0.7;
  const nextStatus: CallLifecycleStatus = pickedUp
    ? CallLifecycleStatus.PICKED
    : CallLifecycleStatus.NO_ANSWER;

  await prisma.call.update({
    where: { id: call.id },
    data: { status: nextStatus },
  });

  await prisma.campaignContact.update({
    where: { id: campaignContact.id },
    data: { lastCallAt: new Date() },
  });

  return { callId: call.id, status: nextStatus };
}

async function endMockCall(callId: string): Promise<void> {
  const existingCall = await prisma.call.findUnique({
    where: { id: callId },
  });

  if (!existingCall) {
    throw new Error("Call not found");
  }

  const durationSec = Math.floor(Math.random() * 31) + 10;
  const callStatusForAnalysis: AICallStatus =
    existingCall.status === CallLifecycleStatus.NO_ANSWER ? "NO_ANSWER" : "PICKED";

  const [campaign, lead] = await Promise.all([
    prisma.campaign.findUnique({
      where: { id: existingCall.campaignId },
      select: { name: true },
    }),
    prisma.campaignContact.findUnique({
      where: { id: existingCall.leadId },
      select: { contact: { select: { name: true } } },
    }),
  ]);

  const campaignName = campaign?.name || "Campaign";
  const leadName = lead?.contact?.name || "Lead";

  const aiResult = await analyzeCallOutcome({
    campaignName,
    leadName,
    callStatus: callStatusForAnalysis,
  });

  await prisma.call.update({
    where: { id: existingCall.id },
    data: {
      status: CallLifecycleStatus.COMPLETED,
      durationSec,
      interestLevel: aiResult.interestLevel,
      summary: aiResult.summary,
    },
  });

  if (existingCall.leadId) {
    const leadStatus =
      aiResult.interestLevel === "HOT"
        ? "HOT"
        : aiResult.interestLevel === "WARM"
        ? "WARM"
        : "COLD";
    await prisma.campaignContact.update({
      where: { id: existingCall.leadId },
      data: {
        lastCallAt: new Date(),
        status: leadStatus,
      },
    });
  }
}

export async function processNextLead(campaignId: string): Promise<boolean> {
  const lead = await prisma.campaignContact.findFirst({
    where: {
      campaignId,
      callStatus: CallStatus.PENDING,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!lead) return false;

  const claim = await prisma.campaignContact.updateMany({
    where: {
      id: lead.id,
      callStatus: CallStatus.PENDING,
    },
    data: { callStatus: CallStatus.IN_PROGRESS },
  });

  if (claim.count === 0) {
    return true;
  }

  try {
    console.log(`[CALL START] Lead ${lead.id}`);
    const { callId } = await startMockCall(lead.id);
    await sleep(randomBetween(2000, 4000));
    await endMockCall(callId);
    await prisma.campaignContact.update({
      where: { id: lead.id },
      data: { callStatus: CallStatus.COMPLETED },
    });
    console.log(`[CALL END] Lead ${lead.id}`);
  } catch (err) {
    await prisma.campaignContact.update({
      where: { id: lead.id },
      data: { callStatus: CallStatus.FAILED },
    });
  }

  return true;
}

const activeCampaigns = new Set<string>();

export async function startBatchProcessing(campaignId: string): Promise<void> {
  if (activeCampaigns.has(campaignId)) return;
  activeCampaigns.add(campaignId);

  try {
    console.log(`[BATCH START] Campaign ${campaignId}`);
    
    while (true) {
      const hasNext = await processNextLead(campaignId);
      if (!hasNext) break;
      
      // Rate limiting: Add delay after each call ends (before next call starts)
      if (CALL_DELAY_MS > 0) {
        console.log(`[RATE LIMIT] Waiting ${CALL_DELAY_MS / 1000}s before next call`);
        await sleep(CALL_DELAY_MS);
      } else {
        // Fallback to random delay if CALL_DELAY_MS is 0
        await sleep(randomBetween(5000, 10000));
      }
    }
    
    console.log(`[BATCH COMPLETE] Campaign ${campaignId}`);
  } finally {
    activeCampaigns.delete(campaignId);
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { batchActive: false },
    });
  }
}

export async function resumeActiveBatches(): Promise<void> {
  const campaigns = await prisma.campaign.findMany({
    where: { batchActive: true },
    select: { id: true },
  });

  for (const campaign of campaigns) {
    await prisma.campaignContact.updateMany({
      where: {
        campaignId: campaign.id,
        callStatus: CallStatus.IN_PROGRESS,
      },
      data: { callStatus: CallStatus.PENDING },
    });

    void startBatchProcessing(campaign.id);
  }
}
