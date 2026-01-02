// backend/src/batchOrchestrator.ts
// Batch call orchestrator for sequential call execution

import { prisma } from "./prisma";
import { eventBus, type SSEEvent } from "./eventBus";
import { isWithinCallingWindow, getNextValidCallTime, formatNextCallTime } from "./timeWindow";
import { recordOutcomePattern } from "./outcomeLearning";
import { selectAdaptiveStrategy, type AdaptiveStrategyContext } from "./adaptiveStrategy";
import twilio from "twilio";

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

/**
 * Active batch job tracker (in-memory)
 * Key: batchJobId, Value: { isRunning: boolean; shouldStop: boolean; isPaused: boolean }
 */
const activeBatchJobs = new Map<string, { isRunning: boolean; shouldStop: boolean; isPaused: boolean }>();

/**
 * Execute a single call in the batch sequence.
 * This is a helper function that wraps the existing call logic.
 */
async function executeBatchCall(campaignContactId: string, batchJobId: string): Promise<{
  success: boolean;
  callLogId?: string;
  callSid?: string;
  error?: string;
}> {
  try {
    const campaignContact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
      include: { contact: true },
    });

    if (!campaignContact) {
      return { success: false, error: "CampaignContact not found" };
    }

    // Select adaptive strategy before starting call
    const strategyContext: AdaptiveStrategyContext = {
      campaignId: campaignContact.campaignId,
      leadStatus: campaignContact.status,
      emotion: null, // Will be detected during call
      urgencyLevel: null, // Will be detected during call
      objections: campaignContact.objections || [],
    };
    
    const adaptiveStrategy = await selectAdaptiveStrategy(strategyContext);

    const to = campaignContact.contact.phone;
    const from = process.env.TWILIO_PHONE_NUMBER;

    if (!from) {
      return { success: false, error: "TWILIO_PHONE_NUMBER not set" };
    }

    // Check for human override to stop batch
    const humanOverride = (campaignContact as any).extraContext?.humanOverride;
    if (humanOverride && humanOverride.stopBatch === true) {
      return { success: false, error: "Batch stopped by human override" };
    }

    const call = await twilioClient.calls.create({
      to,
      from,
      url: process.env.TWILIO_VOICE_URL || "https://f0a695947687.ngrok-free.app/",
    });

    // Create call log with adaptive strategy (safe try/catch for backward compatibility)
    let callLog;
    try {
      callLog = await prisma.callLog.create({
        data: {
          campaignContactId: campaignContact.id,
          twilioCallSid: call.sid,
          scriptVariant: adaptiveStrategy.scriptVariant,
          voiceTone: adaptiveStrategy.voiceTone,
          speechRate: adaptiveStrategy.speechRate,
        } as any, // Type assertion for backward compatibility
      });
    } catch (err: any) {
      // If fields don't exist, create without them
      if (err?.code === 'P2002' || err?.message?.includes('Unknown field')) {
        callLog = await prisma.callLog.create({
          data: {
            campaignContactId: campaignContact.id,
            twilioCallSid: call.sid,
          },
        });
      } else {
        throw err;
      }
    }

    const updatedCampaignContact = await prisma.campaignContact.update({
      where: { id: campaignContact.id },
      data: {
        lastCallAt: new Date(),
      },
    });

    // Emit STRATEGY_SELECTED SSE event
    const strategySelectedEvent: SSEEvent = {
      type: 'STRATEGY_SELECTED',
      campaignId: campaignContact.campaignId,
      contactId: campaignContact.contactId,
      campaignContactId: campaignContact.id,
      data: {
        scriptVariant: adaptiveStrategy.scriptVariant,
        voiceTone: adaptiveStrategy.voiceTone,
        speechRate: adaptiveStrategy.speechRate,
        openingStrategy: adaptiveStrategy.openingStrategy,
        reason: adaptiveStrategy.reason.join('; '),
      },
    };
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] STRATEGY_SELECTED (batch) payload:', JSON.stringify(strategySelectedEvent, null, 2));
    }
    
    eventBus.emit('event', strategySelectedEvent);

    // Emit SSE event for call started
    const callStartedEvent: SSEEvent = {
      type: 'CALL_STARTED',
      campaignId: campaignContact.campaignId,
      contactId: campaignContact.contactId,
      campaignContactId: campaignContact.id,
      data: {
        ...(updatedCampaignContact.lastCallAt && { lastCallAt: updatedCampaignContact.lastCallAt.toISOString() }),
        callSid: call.sid,
        callLogId: callLog.id,
        batchJobId, // Include batch job ID for tracking
      },
    };
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] CALL_STARTED (batch) payload:', JSON.stringify(callStartedEvent, null, 2));
    }
    
    eventBus.emit('event', callStartedEvent);

    return {
      success: true,
      callLogId: callLog.id,
      callSid: call.sid,
    };
  } catch (err: any) {
    console.error('[BatchOrchestrator] Error executing call:', err);
    return {
      success: false,
      error: String(err?.message || err),
    };
  }
}

/**
 * Get retry metadata from CampaignContact.
 * Uses extraContext for backward compatibility (no schema migration required).
 */
export async function getRetryMetadata(campaignContactId: string): Promise<{
  retryCount: number;
  lastAttemptedAt: Date | null;
  lastRetryReason: string | null;
}> {
  try {
    const contact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
    });
    
    if (!contact) {
      return { retryCount: 0, lastAttemptedAt: null, lastRetryReason: null };
    }
    
    // Try to get from extraContext (if exists)
    const extraContext = (contact as any).extraContext;
    if (extraContext?.retryMetadata) {
      return {
        retryCount: extraContext.retryMetadata.retryCount || 0,
        lastAttemptedAt: extraContext.retryMetadata.lastAttemptedAt 
          ? new Date(extraContext.retryMetadata.lastAttemptedAt) 
          : null,
        lastRetryReason: extraContext.retryMetadata.lastRetryReason || null,
      };
    }
    
    // Fallback: count NOT_PICK calls as retry count
    const notPickCalls = await prisma.callLog.count({
      where: {
        campaignContactId,
        resultStatus: 'NOT_PICK',
      },
    });
    
    return {
      retryCount: notPickCalls,
      lastAttemptedAt: contact.lastCallAt,
      lastRetryReason: null,
    };
  } catch (err) {
    console.error('[BatchOrchestrator] Error getting retry metadata:', err);
    return { retryCount: 0, lastAttemptedAt: null, lastRetryReason: null };
  }
}

/**
 * Update retry metadata on CampaignContact.
 * Uses extraContext for backward compatibility.
 */
export async function updateRetryMetadata(
  campaignContactId: string,
  retryCount: number,
  lastRetryReason: string
): Promise<void> {
  try {
    const contact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
    });
    
    if (!contact) return;
    
    const extraContext = (contact as any).extraContext || {};
    extraContext.retryMetadata = {
      retryCount,
      lastAttemptedAt: new Date().toISOString(),
      lastRetryReason,
    };
    
    await (prisma.campaignContact.update as any)({
      where: { id: campaignContactId },
      data: {
        extraContext: extraContext,
      },
    });
  } catch (err) {
    // If extraContext field doesn't exist, log warning but don't fail
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[BatchOrchestrator] Could not update retry metadata (extraContext may not exist):', err);
    }
  }
}

/**
 * Check if a lead is eligible for batch calling.
 * Eligibility rules:
 * - NOT_PICK: eligible if retry count < maxRetries
 * - COLD: eligible if lastCallAt is null or > cooldownHours ago
 * - WARM: eligible if lastCallAt is null or > cooldownHours ago
 * - HOT: NOT eligible (pause batch)
 */
async function isLeadEligible(
  campaignContactId: string,
  maxRetries: number,
  cooldownHours: number
): Promise<{ eligible: boolean; reason?: string; retryCount?: number }> {
  try {
    const campaignContact = await prisma.campaignContact.findUnique({
      where: { id: campaignContactId },
      include: {
        calls: {
          where: {
            resultStatus: 'NOT_PICK',
          },
          orderBy: { startedAt: 'desc' },
        },
      },
    });

    if (!campaignContact) {
      return { eligible: false, reason: "CampaignContact not found" };
    }

    // Check for human override to stop batch
    const humanOverride = (campaignContact as any).extraContext?.humanOverride;
    if (humanOverride && humanOverride.stopBatch === true) {
      return { eligible: false, reason: "Batch stopped by human override" };
    }

    // HOT leads pause the batch
    if (campaignContact.status === 'HOT') {
      return { eligible: false, reason: "Lead is HOT - batch paused" };
    }

    // Check NOT_PICK retry count
    if (campaignContact.status === 'NOT_PICK') {
      const notPickCalls = campaignContact.calls.filter(call => call.resultStatus === 'NOT_PICK');
      if (notPickCalls.length >= maxRetries) {
        return { eligible: false, reason: `Max retries (${maxRetries}) reached for NOT_PICK`, retryCount: notPickCalls.length };
      }
    }

    // Check cooldown period
    if (campaignContact.lastCallAt) {
      const hoursSinceLastCall = (Date.now() - campaignContact.lastCallAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastCall < cooldownHours) {
        return { eligible: false, reason: `Cooldown period not met (${Math.round(hoursSinceLastCall)}h < ${cooldownHours}h)` };
      }
    }

    return { eligible: true };
  } catch (err) {
    console.error('[BatchOrchestrator] Error checking eligibility:', err);
    return { eligible: false, reason: "Error checking eligibility" };
  }
}

/**
 * Execute batch call sequence.
 * This runs sequentially, one call at a time, with safety checks.
 */
export async function executeBatchSequence(
  batchJobId: string,
  campaignId: string,
  leadIds: string[],
  cooldownHours: number,
  maxRetries: number,
  startIndex: number = 0
): Promise<void> {
  // Mark batch as running
  activeBatchJobs.set(batchJobId, { isRunning: true, shouldStop: false, isPaused: false });

  try {
    // Get current job to preserve totalLeads if resuming
    const existingJob = await prisma.batchCallJob.findUnique({
      where: { id: batchJobId },
    });

    // Update batch job status to RUNNING
    await prisma.batchCallJob.update({
      where: { id: batchJobId },
      data: {
        status: 'RUNNING',
        currentIndex: startIndex,
        totalLeads: existingJob?.totalLeads || leadIds.length,
      },
    });

    // Emit BATCH_STARTED event (only if starting from beginning)
    if (startIndex === 0) {
      const batchStartedEvent: SSEEvent = {
        type: 'BATCH_STARTED',
        campaignId,
        contactId: '',
        data: {
          batchJobId,
          totalLeads: existingJob?.totalLeads || leadIds.length,
        },
      };
      
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] BATCH_STARTED payload:', JSON.stringify(batchStartedEvent, null, 2));
      }
      
      eventBus.emit('event', batchStartedEvent);
    }

    // Process leads sequentially
    for (let i = 0; i < leadIds.length; i++) {
      // Check if batch should stop (human override or cancellation)
      const batchJob = activeBatchJobs.get(batchJobId);
      if (!batchJob || batchJob.shouldStop) {
        await (prisma as any).batchCallJob.update({
          where: { id: batchJobId },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
          },
        });
        
        // Emit BATCH_CANCELLED event
        const batchCancelledEvent: SSEEvent = {
          type: 'BATCH_CANCELLED',
          campaignId,
          contactId: '',
          data: {
            batchJobId,
            currentIndex: i,
            totalLeads: leadIds.length,
          },
        };
        
        if (process.env.NODE_ENV !== 'production') {
          console.log('[SSE] BATCH_CANCELLED payload:', JSON.stringify(batchCancelledEvent, null, 2));
        }
        
        eventBus.emit('event', batchCancelledEvent);
        break;
      }

      // Check if batch is paused (before processing next lead)
      const currentBatchJob = activeBatchJobs.get(batchJobId);
      if (currentBatchJob?.isPaused) {
        // Exit loop gracefully - job is paused, don't mark as completed
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[BatchOrchestrator] Batch ${batchJobId} is paused, exiting loop at index ${i}`);
        }
        return; // Exit function, preserving currentIndex in database
      }

      const campaignContactId = leadIds[i];
      
      if (!campaignContactId) {
        continue; // Skip if undefined
      }

      // Check if lead became HOT (pause batch)
      const currentContact = await prisma.campaignContact.findUnique({
        where: { id: campaignContactId },
      });
      
      if (currentContact?.status === 'HOT') {
        // Pause batch
        await prisma.batchCallJob.update({
          where: { id: batchJobId },
          data: {
            status: 'PAUSED',
            pausedAt: new Date(),
            currentIndex: i,
          },
        });
        
        // Emit BATCH_PAUSED event
        const batchPausedEvent: SSEEvent = {
          type: 'BATCH_PAUSED',
          campaignId,
          contactId: '',
          campaignContactId,
          data: {
            batchJobId,
            currentIndex: i,
            totalLeads: leadIds.length,
            reason: 'Lead became HOT',
          },
        };
        
        if (process.env.NODE_ENV !== 'production') {
          console.log('[SSE] BATCH_PAUSED payload:', JSON.stringify(batchPausedEvent, null, 2));
        }
        
        eventBus.emit('event', batchPausedEvent);
        break;
      }

      // Stop retries if status is WARM or handoff recommended
      if (currentContact?.status === 'WARM' || currentContact?.handoffRecommended) {
        // Skip this lead - no more retries needed
        const absoluteIndex = startIndex + i + 1;
        const totalLeads = existingJob?.totalLeads || leadIds.length;
        await prisma.batchCallJob.update({
          where: { id: batchJobId },
          data: { currentIndex: absoluteIndex },
        });
        
        const skipEvent: SSEEvent = {
          type: 'BATCH_PROGRESS',
          campaignId,
          contactId: '',
          campaignContactId,
          data: {
            batchJobId,
            currentIndex: absoluteIndex,
            totalLeads,
            skipped: true,
            reason: currentContact.status === 'WARM' ? 'Lead is WARM - no retries needed' : 'Handoff recommended - no retries needed',
          },
        };
        
        if (process.env.NODE_ENV !== 'production') {
          console.log('[SSE] BATCH_PROGRESS (skipped) payload:', JSON.stringify(skipEvent, null, 2));
        }
        
        eventBus.emit('event', skipEvent);
        continue;
      }

      // Check time window before calling
      const now = new Date();
      if (!isWithinCallingWindow(now)) {
        // Outside calling window - schedule retry
        const nextValidTime = getNextValidCallTime(now);
        const nextValidTimeStr = formatNextCallTime(nextValidTime);
        
        // Get retry metadata
        const retryMeta = await getRetryMetadata(campaignContactId);
        
        // Update retry metadata
        await updateRetryMetadata(
          campaignContactId,
          retryMeta.retryCount,
          `Outside calling window - next retry at ${nextValidTimeStr}`
        );
        
        // Update progress
        const absoluteIndex = startIndex + i + 1;
        const totalLeads = existingJob?.totalLeads || leadIds.length;
        await prisma.batchCallJob.update({
          where: { id: batchJobId },
          data: { currentIndex: absoluteIndex },
        });
        
        // Emit SSE event for skipped call
        const skippedEvent: SSEEvent = {
          type: 'BATCH_SKIPPED_OUTSIDE_TIME_WINDOW',
          campaignId,
          contactId: currentContact?.contactId || '',
          campaignContactId,
          data: {
            batchJobId,
            currentIndex: absoluteIndex,
            totalLeads,
            skipped: true,
            reason: 'Outside calling hours',
            nextRetryTime: nextValidTime.toISOString(),
            retryCount: retryMeta.retryCount,
          },
        };
        
        if (process.env.NODE_ENV !== 'production') {
          console.log('[SSE] BATCH_SKIPPED_OUTSIDE_TIME_WINDOW payload:', JSON.stringify(skippedEvent, null, 2));
        }
        
        eventBus.emit('event', skippedEvent);
        continue;
      }

      // Check eligibility
      const eligibility = await isLeadEligible(campaignContactId, maxRetries, cooldownHours);
      
      if (!eligibility.eligible) {
        // Skip this lead and continue
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[BatchOrchestrator] Skipping lead ${campaignContactId}: ${eligibility.reason}`);
        }
        
        // Update progress
        const absoluteIndex = startIndex + i + 1;
        const totalLeads = existingJob?.totalLeads || leadIds.length;
        await prisma.batchCallJob.update({
          where: { id: batchJobId },
          data: { currentIndex: absoluteIndex },
        });
        
        // Emit progress event
        const progressEventData: any = {
          batchJobId,
          currentIndex: absoluteIndex,
          totalLeads,
          skipped: true,
        };
        if (eligibility.reason) {
          progressEventData.reason = eligibility.reason;
        }
        const progressEvent: SSEEvent = {
          type: 'BATCH_PROGRESS',
          campaignId,
          contactId: '',
          ...(campaignContactId ? { campaignContactId } : {}),
          data: progressEventData,
        };
        
        if (process.env.NODE_ENV !== 'production') {
          console.log('[SSE] BATCH_PROGRESS (skipped) payload:', JSON.stringify(progressEvent, null, 2));
        }
        
        eventBus.emit('event', progressEvent);
        continue;
      }

      // Execute call
      const callResult = await executeBatchCall(campaignContactId, batchJobId);
      
      // Get contact info for event
      const contactInfo = await prisma.campaignContact.findUnique({
        where: { id: campaignContactId },
        select: { contactId: true },
      });
      
      // Update progress (add startIndex to get absolute position)
      await prisma.batchCallJob.update({
        where: { id: batchJobId },
        data: { currentIndex: startIndex + i + 1 },
      });
      
      // Emit progress event
      const absoluteIndex = startIndex + i + 1;
      const totalLeads = existingJob?.totalLeads || leadIds.length;
      const progressEventData: any = {
        batchJobId,
        currentIndex: absoluteIndex,
        totalLeads,
        success: callResult.success,
      };
      if (callResult.callLogId) {
        progressEventData.callLogId = callResult.callLogId;
      }
      if (callResult.callSid) {
        progressEventData.callSid = callResult.callSid;
      }
      const progressEvent: SSEEvent = {
        type: 'BATCH_PROGRESS',
        campaignId,
        contactId: contactInfo?.contactId || '',
        ...(campaignContactId ? { campaignContactId } : {}),
        data: progressEventData,
      };
      
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] BATCH_PROGRESS payload:', JSON.stringify(progressEvent, null, 2));
      }
      
      eventBus.emit('event', progressEvent);

      // Wait for cooldown period before next call (except for last call)
      if (i < leadIds.length - 1) {
        const cooldownMs = cooldownHours * 60 * 60 * 1000;
        await new Promise(resolve => setTimeout(resolve, cooldownMs));
      }
    }

    // Mark batch as completed
    const finalBatchJob = activeBatchJobs.get(batchJobId);
    if (finalBatchJob && !finalBatchJob.shouldStop) {
      await prisma.batchCallJob.update({
        where: { id: batchJobId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
      
      // Record outcome patterns for any converted leads in this batch
      // Get all campaign contacts that were converted during this batch
      const convertedContacts = await prisma.campaignContact.findMany({
        where: {
          campaignId,
          isConverted: true,
          convertedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Within last 24 hours
          },
        },
        include: {
          calls: {
            orderBy: { startedAt: 'desc' },
            take: 1,
          },
        },
      });

      // Record patterns for each converted lead
      for (const contact of convertedContacts) {
        const mostRecentCall = contact.calls[0];
        if (mostRecentCall) {
          await recordOutcomePattern(
            {
              id: mostRecentCall.id,
              campaignContactId: contact.id,
              scriptVariant: mostRecentCall.scriptVariant,
              voiceTone: mostRecentCall.voiceTone,
              emotion: mostRecentCall.emotion,
              urgencyLevel: mostRecentCall.urgencyLevel,
              outcomeBucket: mostRecentCall.outcomeBucket,
            },
            {
              id: contact.id,
              campaignId: contact.campaignId,
              objections: contact.objections,
              isConverted: true,
            }
          );
        }
      }
      
      // Emit BATCH_COMPLETED event
      const batchCompletedEvent: SSEEvent = {
        type: 'BATCH_COMPLETED',
        campaignId,
        contactId: '',
        data: {
          batchJobId,
          totalLeads: leadIds.length,
        },
      };
      
      if (process.env.NODE_ENV !== 'production') {
        console.log('[SSE] BATCH_COMPLETED payload:', JSON.stringify(batchCompletedEvent, null, 2));
      }
      
      eventBus.emit('event', batchCompletedEvent);
    }

  } catch (err) {
    console.error('[BatchOrchestrator] Error in batch sequence:', err);
    
    // Mark batch as failed
    await prisma.batchCallJob.update({
      where: { id: batchJobId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });
  } finally {
    // Clean up
    activeBatchJobs.delete(batchJobId);
  }
}

/**
 * Stop a running batch job (human override).
 */
export function stopBatchJob(batchJobId: string, cancelledBy?: string): void {
  const batchJob = activeBatchJobs.get(batchJobId);
  if (batchJob) {
    batchJob.shouldStop = true;
  }
  
  // Update database
  prisma.batchCallJob.update({
    where: { id: batchJobId },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelledBy: cancelledBy || null,
    },
  }).catch((err: any) => {
    console.error('[BatchOrchestrator] Error cancelling batch job:', err);
  });
}

/**
 * Pause a running batch job.
 */
export function pauseBatchJob(batchJobId: string): void {
  const batchJob = activeBatchJobs.get(batchJobId);
  if (batchJob) {
    batchJob.isPaused = true;
  }
}

/**
 * Resume a paused batch job.
 * Returns the job data needed to resume execution.
 */
export async function resumeBatchJob(batchJobId: string): Promise<{
  campaignId: string;
  leadIds: string[];
  cooldownHours: number;
  maxRetries: number;
  startIndex: number;
} | null> {
  const batchJob = activeBatchJobs.get(batchJobId);
  if (batchJob) {
    batchJob.isPaused = false;
  }

  // Get job data from database
  const job = await prisma.batchCallJob.findUnique({
    where: { id: batchJobId },
  });

  if (!job || job.status !== 'PAUSED') {
    return null;
  }

  // Get eligible campaign contacts (same logic as batch start)
  const allContacts = await prisma.campaignContact.findMany({
    where: {
      campaignId: job.campaignId,
      status: {
        in: ['NOT_PICK', 'COLD', 'WARM'],
      },
    },
    include: {
      calls: {
        where: {
          resultStatus: 'NOT_PICK',
        },
      },
    },
    orderBy: [
      { status: 'asc' },
      { lastCallAt: 'asc' },
    ],
  });

  // Filter eligible leads based on safety rules
  const eligibleLeadIds: string[] = [];
  const now = Date.now();

  for (const contact of allContacts) {
    // Check NOT_PICK retry count
    if (contact.status === 'NOT_PICK') {
      const notPickCount = contact.calls.filter(c => c.resultStatus === 'NOT_PICK').length;
      if (notPickCount >= job.maxRetries) {
        continue; // Skip - max retries reached
      }
    }

    // Check cooldown period
    if (contact.lastCallAt) {
      const hoursSinceLastCall = (now - contact.lastCallAt.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastCall < job.cooldownHours) {
        continue; // Skip - cooldown not met
      }
    }

    eligibleLeadIds.push(contact.id);
  }

  return {
    campaignId: job.campaignId,
    leadIds: eligibleLeadIds,
    cooldownHours: job.cooldownHours,
    maxRetries: job.maxRetries,
    startIndex: job.currentIndex,
  };
}
