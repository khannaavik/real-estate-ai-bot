// backend/src/followUpDecision.ts
// AI-driven follow-up decision logic for automated lead nurturing

import type { LeadStatus } from "@prisma/client";

/**
 * Follow-up channel types for automated lead nurturing.
 */
export type FollowUpChannel = "call" | "whatsapp" | "email";

/**
 * Follow-up decision result.
 * Contains the complete follow-up plan for a lead.
 */
export interface FollowUpDecision {
  followUpAfterHours: number | null;    // Hours to wait before follow-up (null = no follow-up)
  followUpChannel: FollowUpChannel | null;  // Channel to use (null = no follow-up)
  followUpMessageIntent: string | null; // Intent/guidance for message content (null = no follow-up)
}

/**
 * CampaignContact data required for follow-up decision.
 * This is a minimal interface - can work with full Prisma CampaignContact or partial data.
 */
export interface CampaignContactForFollowUp {
  status: LeadStatus;
  lastCallAt?: Date | null;
  // Can include other fields if needed for future enhancements
}

/**
 * Decide follow-up plan based on lead status and engagement level.
 * 
 * Decision Logic Flow:
 * 1. Check lead status (HOT, WARM, COLD, NOT_PICK)
 * 2. Apply status-based follow-up rules
 * 3. Return follow-up plan (timing, channel, message intent)
 * 
 * Follow-up Rules by Status:
 * - HOT: High engagement → immediate human callback within 2 hours (call channel)
 * - WARM: Moderate engagement → WhatsApp summary + scheduled call in 48h (whatsapp + call)
 * - COLD: Low engagement → informational WhatsApp only, no call (whatsapp channel)
 * - NOT_PICK: No response → retry call next day (call channel, 24 hours)
 * 
 * Implementation Notes:
 * - This function ONLY decides the follow-up plan, it does NOT send messages
 * - Future automation can use followUpPlannedAt timestamp to schedule executions
 * - Message intent provides guidance for AI message generation, not hardcoded text
 * - Channel can be used to route to appropriate automation system (Twilio, WhatsApp API, Email service)
 * 
 * @param campaignContact - CampaignContact data (minimal: status, lastCallAt)
 * @returns FollowUpDecision object with timing, channel, and message intent
 */
export function decideFollowUp(
  campaignContact: CampaignContactForFollowUp
): FollowUpDecision {
  const { status } = campaignContact;

  // Decision logic based on lead status
  switch (status) {
    case "HOT":
      // HOT leads: High engagement, ready to convert
      // Strategy: Immediate human callback to capitalize on interest
      // This ensures no delay in responding to highly engaged leads
      return {
        followUpAfterHours: 2, // Human callback within 2 hours
        followUpChannel: "call", // Use call channel for personal touch
        followUpMessageIntent: "Schedule human callback to discuss property details, answer questions, and move toward site visit or booking. Reference their previous questions and interest level.",
      };

    case "WARM":
      // WARM leads: Moderate engagement, need nurturing
      // Strategy: WhatsApp summary + scheduled call in 48h
      // Two-step approach: send informational WhatsApp (can be sent immediately when status becomes WARM),
      // then follow up with call for deeper conversation
      // Note: Automation system should send WhatsApp summary immediately when status becomes WARM,
      // then execute this follow-up call in 48h
      return {
        followUpAfterHours: 48, // Follow-up call in 48 hours (after WhatsApp summary)
        followUpChannel: "call", // Primary follow-up is call
        followUpMessageIntent: "After sending WhatsApp summary with property details, pricing, and location highlights, schedule follow-up call to answer questions, address concerns, and discuss site visit. Reference their previous questions and interest level. Keep conversation friendly and engaging.",
      };

    case "COLD":
      // COLD leads: Low engagement, not ready to commit
      // Strategy: Informational WhatsApp only, no pressure
      // Low-touch approach to maintain connection without being pushy
      return {
        followUpAfterHours: 24, // Wait 24 hours before sending
        followUpChannel: "whatsapp", // Use WhatsApp for low-pressure communication
        followUpMessageIntent: "Send informational WhatsApp message with property details, pricing, location highlights. Keep it friendly and informative, no pressure. Include brochure or link if available.",
      };

    case "NOT_PICK":
      // NOT_PICK: Lead didn't respond to call
      // Strategy: Retry call next day at different time
      // Give lead time and try again, maybe they were busy
      return {
        followUpAfterHours: 24, // Retry next day (24 hours)
        followUpChannel: "call", // Retry via call
        followUpMessageIntent: "Retry call to connect with lead. May have been busy during previous attempt. Keep opening brief and friendly.",
      };

    default:
      // Fallback: No follow-up if status is unknown
      return {
        followUpAfterHours: null,
        followUpChannel: null,
        followUpMessageIntent: null,
      };
  }
}

/**
 * Calculate follow-up planned timestamp.
 * This is a helper function to compute when the follow-up should be executed.
 * 
 * Future Automation Integration:
 * - Query CampaignContact records where followUpPlannedAt <= now()
 * - Execute follow-up using followUpChannel and followUpMessageIntent
 * - Mark follow-up as completed (or update plan for next follow-up)
 * 
 * @param lastCallAt - Timestamp of last call (or current time if no call yet)
 * @param followUpAfterHours - Hours to wait before follow-up
 * @returns Calculated DateTime for follow-up execution, or null if no follow-up
 */
export function calculateFollowUpPlannedAt(
  lastCallAt: Date | null | undefined,
  followUpAfterHours: number | null
): Date | null {
  if (!followUpAfterHours || !lastCallAt) {
    return null;
  }

  // Calculate: lastCallAt + followUpAfterHours
  const plannedAt = new Date(lastCallAt);
  plannedAt.setHours(plannedAt.getHours() + followUpAfterHours);
  return plannedAt;
}

