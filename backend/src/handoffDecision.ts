// backend/src/handoffDecision.ts
// Human handoff decision logic for AI caller

import type { LeadStatus } from "@prisma/client";
import type { ConversationMemory } from "./leadScoring";

/**
 * Handoff reason types that trigger human handoff.
 */
export type HandoffReason = 
  | "HOT_LEAD_COMPLEX_QUESTIONS"    // HOT lead with 3+ questions (complex needs)
  | "MULTIPLE_OBJECTIONS"            // More than 2 objections detected
  | "STRONG_BUYING_INTENT_URGENCY";  // Strong buying intent with urgency indicators

/**
 * Handoff decision result.
 */
export interface HandoffDecision {
  handoffRecommended: boolean;      // Whether handoff should happen
  handoffReason: HandoffReason | null;  // Reason code for handoff (null if no handoff)
}

/**
 * CampaignContact data required for handoff decision.
 */
export interface CampaignContactForHandoff {
  status: LeadStatus;
  // Conversation memory data for analysis
  lastQuestionsAsked?: string[];
  objections?: (string | any)[];
}

/**
 * Detect if lead has complex questions.
 * Complex questions = 3 or more different question types asked.
 * 
 * Threshold: 3+ unique question types indicates complex needs requiring human expertise.
 * 
 * @param questions - Array of question types asked by lead
 * @returns true if 3+ unique questions detected
 */
function hasComplexQuestions(questions: string[] = []): boolean {
  // Count unique questions (deduplicated)
  const uniqueQuestions = [...new Set(questions)];
  // Threshold: 3+ questions = complex needs requiring human attention
  return uniqueQuestions.length >= 3;
}

/**
 * Detect if lead has multiple objections.
 * Multiple objections = more than 2 different objection types.
 * 
 * Threshold: >2 unique objections indicates significant concerns requiring human negotiation.
 * 
 * @param objections - Array of objection types raised by lead
 * @returns true if more than 2 unique objections detected
 */
function hasMultipleObjections(objections: (string | any)[] = []): boolean {
  // Normalize to strings and deduplicate
  const normalized = objections.map((obj) => 
    typeof obj === "string" ? obj.toUpperCase() : String(obj).toUpperCase()
  );
  const uniqueObjections = [...new Set(normalized)];
  // Threshold: >2 objections = multiple concerns requiring human handling
  return uniqueObjections.length > 2;
}

/**
 * Detect strong buying intent with urgency.
 * Strong buying intent = HOT status + urgency indicators in transcript.
 * 
 * Urgency indicators include:
 * - Immediate site visit requests
 * - "Today", "tomorrow", "as soon as possible"
 * - Booking/commitment language
 * - Price negotiation discussions
 * 
 * Note: This function currently uses status as proxy for buying intent.
 * Future enhancement: analyze transcript for explicit urgency keywords.
 * 
 * Threshold: HOT status (which already indicates strong interest + engagement).
 * 
 * @param status - Lead status
 * @param transcript - Optional transcript for urgency keyword detection (future enhancement)
 * @returns true if strong buying intent with urgency detected
 */
function hasStrongBuyingIntentWithUrgency(
  status: LeadStatus,
  transcript?: string
): boolean {
  // HOT status already indicates strong interest and engagement
  // This is our primary indicator for buying intent
  if (status !== "HOT") {
    return false;
  }

  // Future enhancement: analyze transcript for urgency keywords
  // For now, HOT status is sufficient indicator
  // Can add transcript analysis later: "today", "tomorrow", "asap", "immediately", "book", "reserve"
  
  return true; // HOT status = strong buying intent
}

/**
 * Decide if human handoff is recommended based on lead status and conversation data.
 * 
 * Handoff Trigger Logic (any ONE triggers handoff):
 * 
 * 1. HOT Lead + Complex Questions:
 *    - Status: HOT
 *    - Threshold: 3+ unique questions asked
 *    - Reason: Complex needs require human expertise for detailed discussion
 *    - Example: Lead asks about price, location, EMI, possession, parking, amenities (4+ questions)
 * 
 * 2. Multiple Objections (>2):
 *    - Threshold: More than 2 unique objections detected
 *    - Reason: Multiple concerns require human negotiation and problem-solving
 *    - Example: Lead has objections about price, location, AND trust (3 objections)
 * 
 * 3. Strong Buying Intent + Urgency:
 *    - Status: HOT
 *    - Reason: Ready to convert, needs immediate human attention for closing
 *    - Note: HOT status already indicates strong interest + engagement
 * 
 * Decision Flow:
 * 1. Check each trigger condition
 * 2. Return first matching reason (prioritized order)
 * 3. If none match, no handoff recommended
 * 
 * AI Behavior Integration:
 * - When handoffRecommended=true, AI should inform user that a human advisor will call
 * - AI tone should be respectful and confident (not apologetic)
 * - AI should explain value of human conversation without undermining AI assistance
 * 
 * Future Notification Integration:
 * - handoffRecommended=true can trigger notifications to sales team
 * - handoffReason can be used for routing/tagging
 * - Integration point: Query CampaignContact where handoffRecommended=true
 * 
 * @param campaignContact - CampaignContact data (status, questions, objections)
 * @param conversationMemory - Optional conversation memory for additional context
 * @param transcript - Optional transcript for urgency detection (future enhancement)
 * @returns HandoffDecision with recommendation and reason
 */
export function decideHumanHandoff(
  campaignContact: CampaignContactForHandoff,
  conversationMemory?: ConversationMemory,
  transcript?: string
): HandoffDecision {
  const { status } = campaignContact;
  
  // Use conversationMemory if provided, otherwise use campaignContact fields
  const questions = conversationMemory?.questions || campaignContact.lastQuestionsAsked || [];
  const objections = conversationMemory?.objections || campaignContact.objections || [];

  // Trigger 1: HOT Lead + Complex Questions
  // Threshold: Status is HOT AND 3+ unique questions asked
  // Rationale: Complex questions indicate detailed needs requiring human expertise
  if (status === "HOT" && hasComplexQuestions(questions)) {
    return {
      handoffRecommended: true,
      handoffReason: "HOT_LEAD_COMPLEX_QUESTIONS",
    };
  }

  // Trigger 2: Multiple Objections (>2)
  // Threshold: More than 2 unique objections detected
  // Rationale: Multiple concerns require human negotiation and problem-solving skills
  if (hasMultipleObjections(objections)) {
    return {
      handoffRecommended: true,
      handoffReason: "MULTIPLE_OBJECTIONS",
    };
  }

  // Trigger 3: Strong Buying Intent + Urgency
  // Threshold: Status is HOT (indicates strong interest + engagement)
  // Rationale: Ready to convert, needs immediate human attention for closing
  if (hasStrongBuyingIntentWithUrgency(status, transcript)) {
    return {
      handoffRecommended: true,
      handoffReason: "STRONG_BUYING_INTENT_URGENCY",
    };
  }

  // No handoff needed - AI can continue handling
  return {
    handoffRecommended: false,
    handoffReason: null,
  };
}

/**
 * Generate AI messaging instruction for human handoff.
 * This tells the AI how to communicate the handoff to the user.
 * 
 * Tone Requirements:
 * - Respectful: Acknowledge value of conversation so far
 * - Confident: Frame handoff as positive next step, not failure
 * - Clear: Explain that human advisor will call to provide detailed assistance
 * 
 * @param handoffReason - Reason code for handoff
 * @param preferredLanguage - Optional language preference for message tone
 * @returns Instruction string for AI prompt
 */
export function generateHandoffMessagingInstruction(
  handoffReason: HandoffReason,
  preferredLanguage?: string
): string {
  const langNote = preferredLanguage === "hi" || preferredLanguage === "hinglish" 
    ? " Use natural Hindi or Hinglish if the lead prefers that language style. "
    : "";

  let reasonContext = "";
  switch (handoffReason) {
    case "HOT_LEAD_COMPLEX_QUESTIONS":
      reasonContext = "Given the detailed questions and high interest level, ";
      break;
    case "MULTIPLE_OBJECTIONS":
      reasonContext = "To address all concerns thoroughly, ";
      break;
    case "STRONG_BUYING_INTENT_URGENCY":
      reasonContext = "To move forward with your interest, ";
      break;
  }

  return `${reasonContext}inform the lead that a human property advisor will call them shortly to provide detailed assistance and answer any remaining questions. ` +
         `Frame this positively: explain that the advisor will have access to all property details and can help with personalized recommendations and next steps. ` +
         `Be respectful and confident - this is a natural escalation to provide better service, not a failure of AI assistance. ` +
         `Do not apologize. Instead, express confidence that the advisor will provide excellent service.${langNote}`;
}

