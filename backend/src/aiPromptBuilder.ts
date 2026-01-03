// backend/src/aiPromptBuilder.ts
// Utility functions for building AI prompts with dynamic tone context

// Local type definition for LeadStatus (Prisma enum may not be exported in all environments)
type LeadStatus = "COLD" | "WARM" | "HOT" | "NOT_PICK";
import { getAIToneContext, generateAIPromptWithTone, type ConversationMemory } from "./leadScoring";

/**
 * Build OpenAI chat completion messages with tone-aware system prompt.
 * This function prepares the messages array for OpenAI API calls.
 * 
 * Usage example:
 * ```typescript
 * const messages = buildAIMessagesWithTone({
 *   status: campaignContact.status,
 *   sentimentTrend: campaignContact.sentimentTrend || [],
 *   conversationMemory: {
 *     questions: campaignContact.lastQuestionsAsked || [],
 *     objections: campaignContact.objections || [],
 *     sentiment: "neutral",
 *     preferredLanguage: campaignContact.preferredLanguage,
 *   },
 *   userMessage: "Generate an opening script for this call",
 *   propertyInfo: "3BHK apartment in downtown area, starting at 1.2 crores"
 * });
 * 
 * const completion = await openai.chat.completions.create({
 *   model: 'gpt-3.5-turbo',
 *   messages: messages
 * });
 * ```
 * 
 * @param options - Configuration for building AI messages
 * @returns Array of message objects for OpenAI chat completion API
 */
export function buildAIMessagesWithTone(options: {
  status: LeadStatus;
  sentimentTrend?: string[];
  conversationMemory?: ConversationMemory;
  userMessage: string;
  propertyInfo?: string;
  handoffRecommended?: boolean;
  handoffReason?: string | null;
  scriptMode?: import("./leadScoring").ScriptMode;
  objectionStrategy?: import("./leadScoring").ObjectionStrategy | null;
  callerIntro?: string; // Optional caller intro to prepend to opening script
  campaignKnowledge?: {
    priceRange?: string;
    amenities?: string[];
    location?: string;
    possession?: string;
    highlights?: string[];
  } | null; // Campaign knowledge base for property information
  voiceKnowledge?: {
    safeTalkingPoints?: string[];
    idealBuyerProfile?: string;
    objectionsLikely?: string[];
    pricingConfidence?: 'LOW' | 'MEDIUM' | 'HIGH';
    doNotSay?: string[];
  } | null; // Voice-extracted structured knowledge (internal use only)
  knowledgeUsageMode?: 'INTERNAL_ONLY' | 'PUBLIC'; // How to use voice knowledge
}): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const {
    status,
    sentimentTrend = [],
    conversationMemory,
    userMessage,
    propertyInfo,
    handoffRecommended,
    handoffReason,
    scriptMode,
    objectionStrategy,
    callerIntro,
    campaignKnowledge,
    voiceKnowledge,
    knowledgeUsageMode,
  } = options;

  // Generate system message with tone context
  // This includes tone instructions based on lead status and sentiment trend
  // Also includes handoff messaging instructions if handoff is recommended
  // Includes script mode instructions for adaptive conversation behavior
  // Includes objection strategy instructions for dynamic reply generation
  // Includes campaign knowledge base if provided
  const systemMessage = generateAIPromptWithTone(
    status,
    sentimentTrend,
    propertyInfo,
    conversationMemory,
    handoffRecommended,
    handoffReason,
    scriptMode,
    objectionStrategy,
    campaignKnowledge,
    voiceKnowledge,
    knowledgeUsageMode
  );

  // Prepend caller intro to user message if provided (for opening scripts only)
  const finalUserMessage = callerIntro ? `${callerIntro}${userMessage}` : userMessage;

  return [
    {
      role: "system",
      content: systemMessage,
    },
    {
      role: "user",
      content: finalUserMessage,
    },
  ];
}

/**
 * Get tone context string for direct use in prompt construction.
 * This is a convenience wrapper around getAIToneContext.
 * 
 * @param status - Current lead status
 * @param sentimentTrend - Array of sentiment readings from recent calls
 * @returns Tone context description string
 */
export function getToneContextString(
  status: LeadStatus,
  sentimentTrend: string[] = []
): string {
  return getAIToneContext(status, sentimentTrend);
}

