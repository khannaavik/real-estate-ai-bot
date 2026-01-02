// backend/src/outcomeLearning.ts
// Deterministic learning system for call outcome patterns

import { prisma } from "./prisma";
import { eventBus, type SSEEvent } from "./eventBus";

/**
 * Record an outcome pattern from a successful call.
 * This captures deterministic values that led to conversion.
 */
export async function recordOutcomePattern(
  callLog: {
    id: string;
    campaignContactId: string;
    scriptVariant?: string | null;
    voiceTone?: string | null;
    emotion?: string | null;
    urgencyLevel?: string | null;
    outcomeBucket?: string | null;
  },
  campaignContact: {
    id: string;
    campaignId: string;
    objections: string[];
    isConverted?: boolean;
  }
): Promise<void> {
  try {
    // Only record if converted
    if (!campaignContact.isConverted) {
      return;
    }

    // Create pattern record (using type assertion for backward compatibility)
    await (prisma as any).outcomeLearningPattern.create({
      data: {
        campaignId: campaignContact.campaignId,
        scriptVariant: callLog.scriptVariant || null,
        voiceTone: callLog.voiceTone || null,
        emotion: callLog.emotion || null,
        urgencyLevel: callLog.urgencyLevel || null,
        objections: campaignContact.objections || [],
        outcomeBucket: callLog.outcomeBucket || null,
        converted: true,
      },
    });

    // Emit SSE event
    const learningEvent: SSEEvent = {
      type: 'OUTCOME_LEARNING_UPDATED',
      campaignId: campaignContact.campaignId,
      contactId: '',
      campaignContactId: campaignContact.id,
      data: {
        patternRecorded: true,
      },
    };

    if (process.env.NODE_ENV !== 'production') {
      console.log('[SSE] OUTCOME_LEARNING_UPDATED payload:', JSON.stringify(learningEvent, null, 2));
    }

    eventBus.emit('event', learningEvent);
  } catch (err: any) {
    // Graceful degradation: if table doesn't exist yet, log warning but don't fail
    if (err?.code === 'P2003' || err?.message?.includes('does not exist') || err?.message?.includes('Unknown model')) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[OutcomeLearning] OutcomeLearningPattern table may not exist yet. Run migration to enable learning.');
      }
    } else {
      console.error('[OutcomeLearning] Error recording pattern:', err);
    }
  }
}

/**
 * Get top performing patterns for a campaign.
 * Groups by scriptVariant, voiceTone, and emotion.
 */
export async function getTopPatterns(campaignId: string): Promise<{
  scriptVariant: string | null;
  voiceTone: string | null;
  emotion: string | null;
  urgencyLevel: string | null;
  conversionCount: number;
  totalAttempts: number;
  conversionRate: number;
}[]> {
  try {
    // Get all patterns for this campaign (using type assertion for backward compatibility)
    const patterns = await (prisma as any).outcomeLearningPattern.findMany({
      where: {
        campaignId,
        converted: true,
      },
    });

    // Group by scriptVariant, voiceTone, emotion, urgencyLevel (STEP 21)
    const grouped = new Map<string, {
      scriptVariant: string | null;
      voiceTone: string | null;
      emotion: string | null;
      urgencyLevel: string | null;
      conversionCount: number;
      totalAttempts: number;
    }>();

    for (const pattern of patterns) {
      const key = `${pattern.scriptVariant || 'null'}|${pattern.voiceTone || 'null'}|${pattern.emotion || 'null'}|${pattern.urgencyLevel || 'null'}`;
      
      if (!grouped.has(key)) {
        grouped.set(key, {
          scriptVariant: pattern.scriptVariant,
          voiceTone: pattern.voiceTone,
          emotion: pattern.emotion,
          urgencyLevel: pattern.urgencyLevel,
          conversionCount: 0,
          totalAttempts: 0,
        });
      }

      const group = grouped.get(key)!;
      group.conversionCount++;
    }

    // Get total attempts (including non-converted) for each combination
    // Note: This is a simplified version - in production, you'd want to track all attempts
    // For now, we'll use conversionCount as a proxy for success rate
    const results = Array.from(grouped.values()).map(group => ({
      ...group,
      totalAttempts: group.conversionCount, // Simplified: assume each conversion = 1 attempt
      conversionRate: 1.0, // Simplified: all recorded patterns are conversions
    }));

    // Sort by conversion count (descending)
    return results.sort((a, b) => b.conversionCount - a.conversionCount);
  } catch (err: any) {
    // Graceful degradation: if table doesn't exist, return empty array
    if (err?.code === 'P2003' || err?.message?.includes('does not exist') || err?.message?.includes('Unknown model')) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[OutcomeLearning] OutcomeLearningPattern table may not exist yet. Run migration to enable learning.');
      }
      return [];
    }
    console.error('[OutcomeLearning] Error getting top patterns:', err);
    return [];
  }
}
