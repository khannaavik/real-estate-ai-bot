// backend/src/aiLearning.ts
// AI self-improvement foundation: capture successful patterns for future ML training

import type { LeadStatus } from "@prisma/client";
import type { ConversationMemory } from "./leadScoring";

/**
 * Successful transcript pattern structure.
 * Captures the sequence and structure of successful conversations.
 */
export interface TranscriptPattern {
  openingApproach: string;           // How the call started (greeting, introduction style)
  questionSequence: string[];         // Order of questions asked by lead
  responseSequence: string[];         // Order of AI responses (summarized)
  engagementPoints: string[];         // Key moments that increased engagement
  closingApproach: string;           // How the call/conversation ended
}

/**
 * Objection-resolution sequence structure.
 * Captures how objections were raised and successfully resolved.
 */
export interface ObjectionResolutionSequence {
  objections: Array<{
    objectionType: string;           // PRICE, LOCATION, TRUST, etc.
    raisedAt: string;                // When in conversation (early/mid/late)
    resolutionApproach: string;      // How it was addressed
    outcome: "resolved" | "partially_resolved" | "deferred";  // Result
  }>;
  overallResolutionStrategy: string; // Overall approach that worked
}

/**
 * Conversation flow structure.
 * Captures the overall structure of successful conversations.
 */
export interface ConversationFlow {
  phases: Array<{
    phase: "opening" | "engagement" | "objection_handling" | "closing";
    duration: number;                 // Seconds spent in this phase
    keyEvents: string[];             // Important events in this phase
  }>;
  totalDuration: number;
  transitionPoints: string[];        // What triggered transitions between phases
}

/**
 * Extract successful transcript pattern from call data.
 * 
 * This function analyzes the transcript and conversation memory to identify
 * patterns that led to successful conversion. These patterns will be used
 * for future ML model training.
 * 
 * TODO: Future ML Implementation
 * - Use NLP to extract semantic patterns, not just keyword-based
 * - Build sequence models to predict successful conversation flows
 * - Create embeddings for transcript patterns
 * - Identify subtle patterns that humans might miss
 * 
 * @param transcript - Full call transcript
 * @param durationSeconds - Call duration
 * @param conversationMemory - Extracted conversation memory
 * @param callSequence - Array of all calls in the conversion journey (for multi-call patterns)
 * @returns TranscriptPattern object
 */
export function extractSuccessfulTranscriptPattern(
  transcript: string,
  durationSeconds: number,
  conversationMemory: ConversationMemory,
  callSequence: Array<{ transcript?: string; durationSeconds?: number }> = []
): TranscriptPattern {
  // For now, extract basic patterns based on conversation memory
  // TODO: Use NLP/AI to extract more sophisticated patterns
  
  const text = (transcript || "").toLowerCase();
  
  // Extract opening approach (first 30 seconds of conversation)
  let openingApproach = "standard";
  if (text.includes("hello") || text.includes("hi")) {
    openingApproach = "friendly_greeting";
  } else if (text.includes("good morning") || text.includes("good afternoon")) {
    openingApproach = "formal_greeting";
  }
  
  // Question sequence (order matters for successful conversations)
  const questionSequence = conversationMemory.questions || [];
  
  // Response sequence (simplified - would need AI analysis for full extraction)
  // TODO: Use AI to summarize AI responses and extract response patterns
  const responseSequence: string[] = [];
  if (questionSequence.length > 0) {
    responseSequence.push("addressed_questions");
  }
  if (conversationMemory.objections.length > 0) {
    responseSequence.push("handled_objections");
  }
  if (text.includes("site visit") || text.includes("visit")) {
    responseSequence.push("scheduled_next_step");
  }
  
  // Engagement points (moments that increased interest)
  const engagementPoints: string[] = [];
  if (text.includes("interested") || text.includes("yes")) {
    engagementPoints.push("explicit_interest_expressed");
  }
  if (text.includes("price") && text.includes("good") || text.includes("reasonable")) {
    engagementPoints.push("positive_price_reaction");
  }
  if (text.includes("visit") || text.includes("see")) {
    engagementPoints.push("site_visit_requested");
  }
  
  // Closing approach
  let closingApproach = "standard";
  if (text.includes("call me") || text.includes("contact me")) {
    closingApproach = "callback_requested";
  } else if (text.includes("send") || text.includes("whatsapp")) {
    closingApproach = "information_requested";
  } else if (text.includes("visit") || text.includes("meet")) {
    closingApproach = "site_visit_scheduled";
  }
  
  return {
    openingApproach,
    questionSequence,
    responseSequence,
    engagementPoints,
    closingApproach,
  };
}

/**
 * Extract objection-resolution sequence from successful conversion.
 * 
 * This captures how objections were raised and successfully resolved,
 * which is critical for training AI to handle objections better.
 * 
 * TODO: Future ML Implementation
 * - Build sequence-to-sequence models for objection handling
 * - Create embeddings for objection-resolution pairs
 * - Train models to predict successful resolution strategies
 * - Use reinforcement learning to optimize objection responses
 * 
 * @param conversationMemory - Extracted conversation memory
 * @param transcript - Full call transcript
 * @param callSequence - Array of all calls in conversion journey
 * @returns ObjectionResolutionSequence object
 */
export function extractObjectionResolutionSequence(
  conversationMemory: ConversationMemory,
  transcript: string,
  callSequence: Array<{ transcript?: string; objections?: string[] }> = []
): ObjectionResolutionSequence {
  const objections = (conversationMemory.objections || []).map((obj) => 
    typeof obj === "string" ? obj.toUpperCase() : String(obj).toUpperCase()
  );
  
  const text = (transcript || "").toLowerCase();
  
  // Extract objection-resolution pairs
  // TODO: Use NLP to identify when objections were raised and how they were resolved
  const objectionResolutions = objections.map((objectionType) => {
    // Determine when objection was raised (simplified heuristic)
    let raisedAt = "mid";
    if (text.indexOf(objectionType.toLowerCase()) < text.length / 3) {
      raisedAt = "early";
    } else if (text.indexOf(objectionType.toLowerCase()) > (text.length * 2) / 3) {
      raisedAt = "late";
    }
    
    // Determine resolution approach (simplified - would need AI analysis)
    // TODO: Use AI to analyze how each objection was actually addressed
    let resolutionApproach = "standard";
    if (objectionType === "PRICE" && text.includes("emi") || text.includes("installment")) {
      resolutionApproach = "financing_options";
    } else if (objectionType === "LOCATION" && text.includes("connectivity") || text.includes("metro")) {
      resolutionApproach = "connectivity_highlights";
    } else if (objectionType === "TRUST" && text.includes("rera") || text.includes("developer")) {
      resolutionApproach = "credibility_establishment";
    }
    
    return {
      objectionType,
      raisedAt,
      resolutionApproach,
      outcome: "resolved" as const, // Assumed resolved if conversion happened
    };
  });
  
  // Overall resolution strategy
  let overallStrategy = "standard";
  if (objections.length === 0) {
    overallStrategy = "no_objections";
  } else if (objections.length === 1) {
    overallStrategy = "single_objection_focused";
  } else {
    overallStrategy = "multiple_objections_systematic";
  }
  
  return {
    objections: objectionResolutions,
    overallResolutionStrategy: overallStrategy,
  };
}

/**
 * Extract conversation flow structure.
 * 
 * Captures the overall structure and phases of successful conversations.
 * 
 * TODO: Future ML Implementation
 * - Use sequence models to predict optimal conversation flow
 * - Build state machines for conversation management
 * - Train models to optimize phase transitions
 * 
 * @param transcript - Full call transcript
 * @param durationSeconds - Call duration
 * @param conversationMemory - Extracted conversation memory
 * @returns ConversationFlow object
 */
export function extractConversationFlow(
  transcript: string,
  durationSeconds: number,
  conversationMemory: ConversationMemory
): ConversationFlow {
  const text = (transcript || "").toLowerCase();
  const phases: ConversationFlow["phases"] = [];
  
  // Opening phase (first 30 seconds)
  phases.push({
    phase: "opening",
    duration: Math.min(30, durationSeconds),
    keyEvents: text.includes("hello") || text.includes("hi") ? ["greeting"] : [],
  });
  
  // Engagement phase (middle portion)
  const engagementDuration = Math.max(0, durationSeconds - 60);
  const engagementEvents: string[] = [];
  if (conversationMemory.questions.length > 0) {
    engagementEvents.push("questions_answered");
  }
  if (text.includes("interested") || text.includes("yes")) {
    engagementEvents.push("interest_expressed");
  }
  
  phases.push({
    phase: "engagement",
    duration: engagementDuration,
    keyEvents: engagementEvents,
  });
  
  // Objection handling phase (if objections exist)
  if (conversationMemory.objections.length > 0) {
    phases.push({
      phase: "objection_handling",
      duration: Math.floor(durationSeconds * 0.3), // Estimate 30% of time on objections
      keyEvents: conversationMemory.objections.map((obj) => 
        `objection_${typeof obj === "string" ? obj.toLowerCase() : String(obj).toLowerCase()}`
      ),
    });
  }
  
  // Closing phase (last 30 seconds)
  phases.push({
    phase: "closing",
    duration: Math.min(30, durationSeconds),
    keyEvents: text.includes("call") || text.includes("visit") || text.includes("send") 
      ? ["next_step_discussed"] 
      : [],
  });
  
  const transitionPoints: string[] = [];
  if (conversationMemory.questions.length > 0) {
    transitionPoints.push("question_answered");
  }
  if (conversationMemory.objections.length > 0) {
    transitionPoints.push("objection_raised");
  }
  if (text.includes("visit") || text.includes("meet")) {
    transitionPoints.push("site_visit_discussed");
  }
  
  return {
    phases,
    totalDuration: durationSeconds,
    transitionPoints,
  };
}

/**
 * Capture successful patterns from a converted lead.
 * 
 * This function extracts and stores patterns from successful conversions
 * for future ML model training. It captures:
 * - Transcript patterns (what worked in the conversation)
 * - Objection-resolution sequences (how objections were successfully handled)
 * - Conversation flow (structure of successful calls)
 * 
 * This is called when a lead is marked as converted (manual flag).
 * 
 * TODO: Future ML Implementation
 * - Batch process successful patterns for model training
 * - Create training datasets from captured patterns
 * - Train models to predict successful conversation strategies
 * - Implement reinforcement learning loop
 * - Build recommendation system for objection handling
 * 
 * @param campaignContactId - ID of converted CampaignContact
 * @param callLogs - Array of CallLog records from the conversion journey
 * @param conversationMemory - Final conversation memory state
 * @returns Created AILearningPattern record ID
 */
export async function captureSuccessfulPatterns(
  campaignContactId: string,
  callLogs: Array<{
    id: string;
    transcript?: string | null;
    durationSeconds?: number | null;
    resultStatus?: LeadStatus | null;
  }>,
  conversationMemory: ConversationMemory
): Promise<string | null> {
  // Find the most successful call (longest duration or HOT status)
  const successfulCall = callLogs
    .filter((call) => call.transcript && call.durationSeconds && call.durationSeconds > 30)
    .sort((a, b) => (b.durationSeconds || 0) - (a.durationSeconds || 0))[0];
  
  if (!successfulCall || !successfulCall.transcript) {
    console.warn('[AILearning] No suitable call found for pattern extraction');
    return null;
  }
  
  // Extract patterns from successful call
  const transcriptPattern = extractSuccessfulTranscriptPattern(
    successfulCall.transcript,
    successfulCall.durationSeconds || 0,
    conversationMemory,
    callLogs.map((call) => ({
      ...(call.transcript && { transcript: call.transcript }),
      ...(call.durationSeconds !== null && call.durationSeconds !== undefined && { durationSeconds: call.durationSeconds }),
    }))
  );
  
  const objectionResolutionSequence = extractObjectionResolutionSequence(
    conversationMemory,
    successfulCall.transcript,
    callLogs.map((call) => ({
      ...(call.transcript && { transcript: call.transcript }),
      objections: conversationMemory.objections,
    }))
  );
  
  const conversationFlow = extractConversationFlow(
    successfulCall.transcript,
    successfulCall.durationSeconds || 0,
    conversationMemory
  );
  
  // Store pattern in database
  // TODO: Future - Store in vector database for similarity search
  // TODO: Future - Generate embeddings for pattern matching
  try {
    const { prisma } = require("./prisma");
    const pattern = await prisma.aILearningPattern.create({
      data: {
        campaignContactId,
        callLogId: successfulCall.id,
        transcriptPattern: transcriptPattern as any,
        objectionResolutionSequence: objectionResolutionSequence as any,
        conversationFlow: conversationFlow as any,
        initialStatus: callLogs[0]?.resultStatus || null,
        finalStatus: "HOT" as LeadStatus, // Assumed HOT if converted
        questionsAsked: conversationMemory.questions,
        objectionsRaised: conversationMemory.objections.map((obj) => 
          typeof obj === "string" ? obj.toUpperCase() : String(obj).toUpperCase()
        ),
        sentimentProgression: conversationMemory.sentiment ? [conversationMemory.sentiment] : [],
        conversionDate: new Date(),
      },
    });
    
    console.log(`[AILearning] Captured successful pattern from conversion: ${pattern.id}`);
    return pattern.id;
  } catch (err) {
    console.error('[AILearning] Error capturing successful pattern:', err);
    return null;
  }
}

/**
 * Placeholder function for learning from successful calls.
 * 
 * This function will be implemented in the future to:
 * - Analyze all successful patterns in AILearningPattern table
 * - Train ML models on successful conversation patterns
 * - Update AI prompt generation based on learned patterns
 * - Build recommendation system for objection handling
 * 
 * TODO: Future ML Implementation
 * 1. Data Collection Phase (Current):
 *    - ✅ Capture successful patterns when leads convert
 *    - ✅ Store transcript patterns, objection resolutions, conversation flows
 * 
 * 2. Model Training Phase (Future):
 *    - Build training dataset from AILearningPattern records
 *    - Create embeddings for transcript patterns
 *    - Train sequence models for conversation flow prediction
 *    - Train models for objection-resolution recommendation
 *    - Implement reinforcement learning loop
 * 
 * 3. Model Integration Phase (Future):
 *    - Update AI prompt generation to use learned patterns
 *    - Build recommendation system for objection handling
 *    - Create similarity matching for conversation patterns
 *    - Implement A/B testing for learned strategies
 * 
 * 4. Continuous Improvement Phase (Future):
 *    - Monitor conversion rates with learned patterns
 *    - Retrain models periodically with new successful patterns
 *    - Implement feedback loop from sales team
 *    - Optimize based on conversion outcomes
 * 
 * @returns Promise that resolves when learning process completes (placeholder)
 */
export async function learnFromSuccessfulCalls(): Promise<void> {
  // TODO: Implement ML model training
  // 1. Query all AILearningPattern records
  // 2. Extract features from patterns (transcript patterns, objection resolutions, flows)
  // 3. Build training dataset
  // 4. Train models:
  //    - Conversation flow prediction model
  //    - Objection-resolution recommendation model
  //    - Response generation optimization model
  // 5. Store trained models
  // 6. Update AI prompt generation to use learned patterns
  
  console.log('[AILearning] learnFromSuccessfulCalls() called - ML training not yet implemented');
  console.log('[AILearning] TODO: Implement model training pipeline');
  
  // Placeholder: In future, this will:
  // - Load all successful patterns from database
  // - Train ML models
  // - Update AI behavior based on learned patterns
  // - Return training metrics
  
  return Promise.resolve();
}

