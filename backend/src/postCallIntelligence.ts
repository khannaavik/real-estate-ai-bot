// backend/src/postCallIntelligence.ts
// Generate structured post-call intelligence summaries

import type { LeadStatus } from "@prisma/client";
import type { ConversationMemory } from "./leadScoring";

/**
 * Interest level classification for leads.
 */
export type InterestLevel = "high" | "medium" | "low" | "none";

/**
 * Structured post-call intelligence data.
 * Contains actionable insights for sales team.
 */
export interface PostCallIntelligence {
  summary: string[];                    // 3-5 bullet point summary of call
  interestLevel: InterestLevel;         // Lead interest classification
  objections: string[];                 // Objections raised (normalized list)
  recommendedNextAction: string;        // Suggested next step for sales team
  bestCallbackTime: string;             // Suggested callback time window
}

/**
 * Generate structured post-call intelligence summary.
 * 
 * This creates a concise, factual summary that sales teams can use immediately
 * without reading the full transcript. The summary focuses on key insights:
 * - What the lead asked about
 * - What concerns they have
 * - How interested they seem
 * - What to do next
 * - When to call back
 * 
 * Example Output:
 * {
 *   summary: [
 *     "Lead expressed strong interest and asked about price, EMI options, and possession timeline",
 *     "Raised concerns about property location and financing process",
 *     "Requested site visit and property brochure",
 *     "Call duration: 4 minutes, positive sentiment throughout"
 *   ],
 *   interestLevel: "high",
 *   objections: ["LOCATION", "FINANCING"],
 *   recommendedNextAction: "Schedule site visit within 48 hours. Send property brochure via WhatsApp. Prepare financing options and location highlights.",
 *   bestCallbackTime: "Tomorrow, 10 AM - 12 PM or 6 PM - 8 PM"
 * }
 * 
 * @param transcript - Call transcript
 * @param durationSeconds - Call duration in seconds
 * @param status - Lead status (HOT, WARM, COLD, NOT_PICK)
 * @param conversationMemory - Extracted conversation memory (questions, objections, sentiment)
 * @returns PostCallIntelligence object with structured insights
 */
export function generatePostCallIntelligence(
  transcript: string,
  durationSeconds: number,
  status: LeadStatus,
  conversationMemory: ConversationMemory
): PostCallIntelligence {
  const { questions, objections, sentiment } = conversationMemory;
  
  // Build summary bullet points (3-5 points)
  const summary: string[] = [];
  
  // 1. Interest and engagement level
  if (status === "HOT") {
    summary.push(`Lead expressed strong interest (${status} status). Engaged actively throughout the call.`);
  } else if (status === "WARM") {
    summary.push(`Lead showed moderate interest (${status} status). Willing to learn more about the property.`);
  } else if (status === "COLD") {
    summary.push(`Lead showed low interest (${status} status). Minimal engagement during call.`);
  } else {
    summary.push(`Call status: ${status}.`);
  }
  
  // 2. Questions asked
  if (questions.length > 0) {
    const questionList = questions.join(", ");
    summary.push(`Asked about: ${questionList}.`);
  }
  
  // 3. Objections raised
  if (objections.length > 0) {
    const objectionList = objections
      .map((obj) => typeof obj === "string" ? obj.toUpperCase() : String(obj).toUpperCase())
      .join(", ");
    summary.push(`Raised concerns: ${objectionList}.`);
  }
  
  // 4. Sentiment and call quality
  if (sentiment === "positive") {
    summary.push(`Positive sentiment throughout. Call duration: ${Math.round(durationSeconds / 60)} minutes.`);
  } else if (sentiment === "negative") {
    summary.push(`Negative sentiment detected. Call duration: ${Math.round(durationSeconds / 60)} minutes.`);
  } else {
    summary.push(`Neutral conversation. Call duration: ${Math.round(durationSeconds / 60)} minutes.`);
  }
  
  // 5. Additional context (if space allows and relevant)
  if (summary.length < 5) {
    if (status === "HOT" && questions.length >= 3) {
      summary.push("Multiple detailed questions indicate serious consideration.");
    } else if (objections.length > 2) {
      summary.push("Multiple concerns raised - may need personalized approach.");
    }
  }
  
  // Ensure summary has at least 3 points (pad if needed)
  while (summary.length < 3) {
    summary.push("Standard follow-up recommended.");
  }
  
  // Limit to 5 points maximum
  const finalSummary = summary.slice(0, 5);
  
  // Determine interest level based on status
  let interestLevel: InterestLevel;
  switch (status) {
    case "HOT":
      interestLevel = "high";
      break;
    case "WARM":
      interestLevel = "medium";
      break;
    case "COLD":
      interestLevel = "low";
      break;
    case "NOT_PICK":
      interestLevel = "none";
      break;
    default:
      interestLevel = "low";
  }
  
  // Normalize objections list
  const normalizedObjections = objections
    .map((obj) => typeof obj === "string" ? obj.toUpperCase() : String(obj).toUpperCase())
    .filter((obj, index, arr) => arr.indexOf(obj) === index); // Remove duplicates
  
  // Generate recommended next action based on status and context
  let recommendedNextAction: string;
  if (status === "HOT") {
    if (objections.length === 0) {
      recommendedNextAction = "Schedule site visit within 24-48 hours. Send property brochure and pricing details via WhatsApp. Prepare booking-related documents.";
    } else if (objections.length <= 2) {
      recommendedNextAction = `Schedule site visit within 48 hours. Address ${normalizedObjections.join(" and ")} concerns with detailed information. Send property brochure.`;
    } else {
      recommendedNextAction = `Immediate human callback recommended. Address multiple concerns: ${normalizedObjections.join(", ")}. Prepare detailed responses and financing options.`;
    }
  } else if (status === "WARM") {
    recommendedNextAction = "Send WhatsApp summary with property details, pricing, and location highlights. Schedule follow-up call in 48 hours to answer questions and discuss site visit.";
  } else if (status === "COLD") {
    recommendedNextAction = "Send informational WhatsApp message with property brochure. Low-pressure follow-up in 1 week. Focus on building awareness and trust.";
  } else {
    recommendedNextAction = "Retry call at different time. May have been busy during initial attempt.";
  }
  
  // Determine best callback time based on status and sentiment
  // For HOT/WARM: suggest sooner, for COLD: suggest later
  let bestCallbackTime: string;
  if (status === "HOT") {
    bestCallbackTime = "Within 2 hours (urgent) or tomorrow, 10 AM - 12 PM or 6 PM - 8 PM";
  } else if (status === "WARM") {
    bestCallbackTime = "Tomorrow, 10 AM - 12 PM or 6 PM - 8 PM, or day after tomorrow, same hours";
  } else if (status === "COLD") {
    bestCallbackTime = "Next week, 10 AM - 12 PM or 6 PM - 8 PM (low priority)";
  } else {
    bestCallbackTime = "Next day, 10 AM - 12 PM or 6 PM - 8 PM (different time slot)";
  }
  
  return {
    summary: finalSummary,
    interestLevel,
    objections: normalizedObjections,
    recommendedNextAction,
    bestCallbackTime,
  };
}

