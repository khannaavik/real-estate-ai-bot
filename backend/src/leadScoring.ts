// backend/src/leadScoring.ts
// Local type definition for LeadStatus (Prisma enum may not be exported in all environments)
type LeadStatus = "COLD" | "WARM" | "HOT" | "NOT_PICK";

export interface LeadScoringInput {
  transcript: string;
  durationSeconds: number;
}

/**
 * Lead intent classification based on explicit statements in conversation.
 */
export type LeadIntent = 'BUY_NOW' | 'BUY_SOON' | 'JUST_EXPLORING' | 'NOT_INTERESTED';

/**
 * Primary objection types for strategy selection.
 * CONFUSION is detected when lead asks basic clarifying questions.
 */
export type PrimaryObjection = "PRICE" | "TRUST" | "LOCATION" | "TIMING" | "FINANCING" | "CONFUSION" | null;

/**
 * Extracted conversation data from transcript analysis
 */
export interface ConversationMemory {
  questions: string[];  // Questions asked by the lead
  objections: (string | ObjectionType)[]; // Objections raised by the lead (uppercase: PRICE, LOCATION, TRUST, TIMING, FINANCING)
  sentiment: "negative" | "neutral" | "positive"; // Sentiment of this conversation
  preferredLanguage?: DetectedLanguage; // Detected language preference: "en" (English), "hi" (Hindi), or "hinglish" (mixed)
  primaryObjection?: PrimaryObjection; // Primary objection detected (used for strategy selection)
}

/**
 * Detect lead intent from transcript using explicit intent phrases.
 * This identifies the buyer's stated or implied intent level.
 * 
 * @param transcript - The conversation transcript
 * @returns LeadIntent classification
 */
export function detectLeadIntent(transcript: string): LeadIntent {
  const text = (transcript || "").toLowerCase().trim();
  
  // BUY_NOW: Strong buying intent with immediate action signals
  const buyNowPhrases = [
    "ready to buy",
    "ready to purchase",
    "book a visit",
    "book a viewing",
    "site visit",
    "schedule a visit",
    "payment plan",
    "when can we close",
    "when can we finalize",
    "i want to buy",
    "i want to purchase",
    "let's proceed",
    "let us proceed",
    "i'm ready",
    "i am ready",
  ];
  if (buyNowPhrases.some((phrase) => text.includes(phrase))) {
    return "BUY_NOW";
  }
  
  // BUY_SOON: Interest with engagement signals (questions about details)
  const buySoonPhrases = [
    "interested",
    "i'm interested",
    "i am interested",
    "share details",
    "send details",
    "send me details",
    "whatsapp me details",
    "price",
    "how much",
    "location",
    "where is",
    "configuration",
    "what configuration",
    "what size",
    "possession",
    "when will it be ready",
    "emi",
    "loan",
  ];
  if (buySoonPhrases.some((phrase) => text.includes(phrase))) {
    return "BUY_SOON";
  }
  
  // JUST_EXPLORING: Casual browsing without strong intent
  const exploringPhrases = [
    "just checking",
    "just browsing",
    "looking around",
    "just exploring",
    "just seeing",
    "just want to know",
    "curious",
    "wondering",
  ];
  if (exploringPhrases.some((phrase) => text.includes(phrase))) {
    return "JUST_EXPLORING";
  }
  
  // Default: No clear intent signals
  return "NOT_INTERESTED";
}

/**
 * Very simple rule-based lead scoring for now.
 * Later we can enhance this with OpenAI.
 */
export function determineLeadStatusFromTranscript(
  input: LeadScoringInput
): LeadStatus {
  const { transcript, durationSeconds } = input;
  const text = (transcript || "").toLowerCase().trim();

  // If call was extremely short, it's almost always cold
  if (!text || durationSeconds < 20) {
    return "COLD";
  }

  // Strong negative phrases → definitely COLD
  const negativePhrases = [
    "not interested",
    "no interest",
    "don't call me",
    "stop calling",
    "already bought",
    "not looking",
    "wrong number",
  ];
  if (negativePhrases.some((p) => text.includes(p))) {
    return "COLD";
  }

  // Explicit interest phrases
  const interestPhrases = [
    "i am interested",
    "i'm interested",
    "yes i am looking",
    "yes, i am looking",
    "looking to buy",
    "looking to invest",
    "send me details",
    "send me the details",
    "please send details",
    "whatsapp me details",
  ];

  const isExplicitInterest = interestPhrases.some((p) =>
    text.includes(p)
  );

  // Indicators of deeper engagement (questions / next steps)
  const questionWords = ["what is the price", "how much", "possession", "rera", "carpet", "built up", "loan", "emi", "parking", "site visit", "visit the site", "when can i visit"];

  const hasManyQuestions =
    questionWords.filter((p) => text.includes(p)).length >= 2;

  const nextStepPhrases = [
    "schedule a visit",
    "site visit",
    "can i visit",
    "let's visit",
    "let us visit",
    "meet tomorrow",
    "meet on",
    "call me tomorrow",
    "call me later",
    "send me brochure",
    "email me",
  ];

  const hasNextStep = nextStepPhrases.some((p) => text.includes(p));

  // Heuristic based on duration
  const longConversation = durationSeconds >= 120; // 2+ minutes
  const mediumConversation = durationSeconds >= 45;

  // HOT logic:
  // - explicit interest AND
  //   (deep questions OR next step OR long duration)
  if (
    isExplicitInterest &&
    (hasManyQuestions || hasNextStep || longConversation)
  ) {
    return "HOT";
  }

  // WARM logic:
  // - explicit interest but not deep yet, OR
  // - medium duration with at least some engagement
  if (isExplicitInterest || mediumConversation) {
    return "WARM";
  }

  // Intent-based status override (applied before final fallback)
  // This uses explicit intent signals to refine status classification
  const intent = detectLeadIntent(transcript);
  switch (intent) {
    case "BUY_NOW":
      // Strong buying intent overrides to HOT status
      return "HOT";
    case "BUY_SOON":
      // Interest signals override to WARM status
      return "WARM";
    case "JUST_EXPLORING":
      // Casual browsing remains COLD
      return "COLD";
    case "NOT_INTERESTED":
      // No clear intent signals remain COLD
      return "COLD";
  }

  // Fallback: if they spoke but no strong signals → COLD
  return "COLD";
}

/**
 * Extract questions asked by the lead from the transcript.
 * Looks for common real estate questions: price, location, carpet area, EMI, possession.
 * 
 * @param transcript - The conversation transcript
 * @returns Array of question types found
 */
export function extractQuestions(transcript: string): string[] {
  const text = (transcript || "").toLowerCase().trim();
  const questions: string[] = [];

  // Price-related questions
  const priceKeywords = ["price", "cost", "how much", "what is the price", "pricing", "rate", "rs", "rupees", "lakh", "crore"];
  if (priceKeywords.some((keyword) => text.includes(keyword))) {
    questions.push("price");
  }

  // Location-related questions
  const locationKeywords = ["location", "where is", "address", "area", "neighborhood", "near", "distance", "how far"];
  if (locationKeywords.some((keyword) => text.includes(keyword))) {
    questions.push("location");
  }

  // Carpet area questions
  const carpetKeywords = ["carpet", "carpet area", "built up", "super built up", "sqft", "square feet", "size"];
  if (carpetKeywords.some((keyword) => text.includes(keyword))) {
    questions.push("carpet area");
  }

  // EMI/Loan questions
  const emiKeywords = ["emi", "loan", "financing", "home loan", "mortgage", "down payment", "installment"];
  if (emiKeywords.some((keyword) => text.includes(keyword))) {
    questions.push("emi");
  }

  // Possession questions
  const possessionKeywords = ["possession", "ready to move", "when can i move", "completion", "handover", "when will it be ready"];
  if (possessionKeywords.some((keyword) => text.includes(keyword))) {
    questions.push("possession");
  }

  // Remove duplicates
  return [...new Set(questions)];
}

/**
 * Lead objection types for structured detection.
 * These represent specific concerns or objections raised by leads.
 */
export type LeadObjection = "PRICE" | "LOCATION" | "TRUST" | "TIMING" | "FINANCING";

/**
 * Objection types that can be detected from conversations.
 * These are stored in uppercase for consistency.
 * @deprecated Use LeadObjection instead - kept for backward compatibility
 */
export type ObjectionType = LeadObjection;

/**
 * Extract objections raised by the lead from the transcript.
 * Identifies common objections: PRICE, LOCATION, TRUST, TIMING, FINANCING.
 * 
 * Objection Detection Flow:
 * 1. Analyze transcript for objection keywords
 * 2. Map detected keywords to objection types
 * 3. Return deduplicated array of objection types in uppercase
 * 
 * @param transcript - The conversation transcript
 * @returns Array of objection types found (uppercase: PRICE, LOCATION, TRUST, TIMING, FINANCING)
 */
export function extractObjections(transcript: string): ObjectionType[] {
  const text = (transcript || "").toLowerCase().trim();
  const objections: ObjectionType[] = [];

  // PRICE objections - detect concerns about cost, affordability, pricing
  const priceObjectionKeywords = [
    "too expensive", "high price", "out of budget", "can't afford", "cannot afford",
    "price is high", "costly", "overpriced", "too costly", "expensive", "afford",
    "budget issue", "budget constraint", "price too high"
  ];
  if (priceObjectionKeywords.some((keyword) => text.includes(keyword))) {
    objections.push("PRICE");
  }

  // LOCATION objections - detect concerns about distance, connectivity, area
  const locationObjectionKeywords = [
    "too far", "far from", "distance is", "not near", "away from", "remote location",
    "far away", "location is", "connectivity", "transport", "commute", "access",
    "neighborhood", "area is", "not connected"
  ];
  if (locationObjectionKeywords.some((keyword) => text.includes(keyword))) {
    objections.push("LOCATION");
  }

  // TRUST objections - detect concerns about credibility, genuineness, trustworthiness
  const trustObjectionKeywords = [
    "not sure", "doubt", "scam", "fraud", "not genuine", "don't trust", "suspicious",
    "verify", "credible", "legitimate", "reliable", "believe", "trustworthy",
    "real estate agent", "broker", "developer"
  ];
  if (trustObjectionKeywords.some((keyword) => text.includes(keyword))) {
    objections.push("TRUST");
  }

  // TIMING objections - detect concerns about readiness, timing, urgency
  const timingObjectionKeywords = [
    "not ready", "not the right time", "later", "not now", "wait", "not interested right now",
    "too early", "too soon", "need time", "think about it", "decide later", "postpone",
    "not urgent", "no hurry"
  ];
  if (timingObjectionKeywords.some((keyword) => text.includes(keyword))) {
    objections.push("TIMING");
  }

  // FINANCING objections - detect concerns about loans, EMI, down payment, financial assistance
  const financingObjectionKeywords = [
    "loan", "emi", "down payment", "financing", "financial", "bank loan", "home loan",
    "mortgage", "affordability", "installment", "payment plan", "finance", "credit",
    "loan approval", "loan process", "financial assistance", "funding"
  ];
  if (financingObjectionKeywords.some((keyword) => text.includes(keyword))) {
    objections.push("FINANCING");
  }

  // Remove duplicates and return in uppercase
  return [...new Set(objections)];
}

/**
 * Determine sentiment from the transcript using keyword-based classification.
 * This is a basic implementation - can be enhanced with NLP/AI later.
 * 
 * @param transcript - The conversation transcript
 * @returns Sentiment classification: "negative", "neutral", or "positive"
 */
export function extractSentiment(transcript: string): "negative" | "neutral" | "positive" {
  const text = (transcript || "").toLowerCase().trim();
  
  // Positive sentiment indicators
  const positiveKeywords = [
    "interested", "yes", "good", "great", "excellent", "perfect", "love", "like",
    "sounds good", "definitely", "sure", "okay", "ok", "alright", "wonderful",
    "amazing", "fantastic", "looking forward", "excited"
  ];
  const positiveCount = positiveKeywords.filter((keyword) => text.includes(keyword)).length;

  // Negative sentiment indicators
  const negativeKeywords = [
    "not interested", "no", "don't", "can't", "won't", "bad", "terrible", "awful",
    "horrible", "disappointed", "frustrated", "angry", "upset", "stop calling",
    "don't call", "wrong number", "already bought", "not looking"
  ];
  const negativeCount = negativeKeywords.filter((keyword) => text.includes(keyword)).length;

  // Classify based on keyword counts
  // If negative keywords significantly outnumber positive, classify as negative
  if (negativeCount > positiveCount && negativeCount >= 2) {
    return "negative";
  }
  
  // If positive keywords significantly outnumber negative, classify as positive
  if (positiveCount > negativeCount && positiveCount >= 2) {
    return "positive";
  }

  // Default to neutral if balanced or no strong signals
  return "neutral";
}

/**
 * Language type definitions for detection.
 */
export type DetectedLanguage = "en" | "hi" | "hinglish";

/**
 * Detect preferred language from transcript using keyword heuristics.
 * 
 * Detection Logic:
 * 1. Count Hindi-specific words (verbs, particles, common Hindi words in English script)
 * 2. Count English-specific indicators (articles, common English words)
 * 3. Determine language based on ratio and presence of mixed patterns
 * 
 * Language Classification:
 * - Hindi (hi): High Hindi word count, minimal English structure
 * - Hinglish (hinglish): Mix of Hindi and English words in same conversation
 * - English (en): Primarily English words, or default if unclear
 * 
 * Heuristic Rules:
 * - If Hindi words present AND English words present → Hinglish
 * - If Hindi words present BUT no English structure → Hindi
 * - If only English words OR no clear indicators → English (default)
 * - Requires minimum text length for reliable detection
 * 
 * @param transcript - The conversation transcript
 * @returns Detected language code: "en" (English), "hi" (Hindi), "hinglish" (mixed), or "en" (default if unclear)
 */
export function detectPreferredLanguage(transcript: string): DetectedLanguage {
  const text = (transcript || "").toLowerCase().trim();
  
  // Need minimum text length for reliable detection
  if (text.length < 10) {
    return "en"; // Default to English if too short
  }

  // Hindi-specific indicators (common Hindi words in English script)
  // These are verbs, particles, and common Hindi words that indicate Hindi usage
  const hindiIndicators = [
    // Verbs and particles
    "hain", "hai", "ho", "hoga", "hogi", "honge", "hona", "ho raha", "ho rahi",
    // Question words
    "kaise", "kya", "kab", "kahan", "kyun", "kis", "kaun", "kaunsi",
    // Common words
    "acha", "theek", "sahi", "bilkul", "zaroor", "yeh", "woh", "usse", "usko",
    "mujhe", "tumhe", "aapko", "hamare", "tumhare", "aapke", "mere",
    // Particles and connectors
    "aur", "bhi", "toh", "lekin", "par", "magar", "ki", "ka", "ke", "ko",
    // Action words
    "dekhna", "samajhna", "karna", "lena", "dena", "aana", "jana", "rahena"
  ];

  // English-specific indicators (articles, common English words that indicate English usage)
  // These help detect when English is actively being used (not just property/technical terms)
  const englishIndicators = [
    // Articles and pronouns
    "the", "a", "an", "this", "that", "these", "those",
    // Common verbs
    "is", "are", "was", "were", "have", "has", "had", "do", "does", "did",
    "can", "could", "will", "would", "should", "may", "might",
    // Common prepositions and connectors
    "and", "or", "but", "if", "when", "where", "why", "how",
    "in", "on", "at", "to", "for", "with", "from", "of", "by",
    // Common adjectives
    "good", "bad", "nice", "great", "better", "best", "important",
    // Common nouns (when used conversationally, not just technical terms)
    "property", "home", "house", "apartment", "flat", "price", "location"
  ];

  // Count Hindi indicators found in transcript
  const hindiCount = hindiIndicators.filter((word) => text.includes(word)).length;
  
  // Count English indicators found in transcript
  // Only count if they appear as standalone words or in common phrases (not just in compound words)
  const englishCount = englishIndicators.filter((word) => {
    // Match word boundaries to avoid false positives (e.g., "the" in "there")
    const regex = new RegExp(`\\b${word}\\b`, "i");
    return regex.test(text);
  }).length;

  // Detection logic based on counts and patterns
  // Threshold: Need at least 2 indicators of a language to be confident
  
  const hasHindi = hindiCount >= 2;
  const hasEnglish = englishCount >= 2;

  // Hinglish detection: Both Hindi and English indicators present
  // This indicates code-switching or mixed language usage
  if (hasHindi && hasEnglish) {
    return "hinglish"; // Mixed Hindi-English (Hinglish)
  }

  // Pure Hindi: Strong Hindi indicators, minimal English
  if (hasHindi && englishCount < 2) {
    return "hi"; // Hindi
  }

  // Pure English: English indicators present, minimal Hindi
  // OR default to English if unclear (most common case)
  return "en"; // English (default)
}

/**
 * Detect objections from transcript using structured keyword matching.
 * This is a focused detection function that identifies specific objection types
 * based on explicit keywords in the conversation.
 * 
 * Detection Rules:
 * - PRICE: Concerns about cost, affordability, pricing
 * - LOCATION: Concerns about distance, area, connectivity
 * - TRUST: Concerns about credibility, builder reputation, reliability
 * - TIMING: Concerns about timing, urgency, readiness
 * - FINANCING: Concerns about loans, EMI, financial assistance
 * 
 * @param transcript - The conversation transcript
 * @returns Array of unique objection types detected (uppercase)
 */
export function detectObjections(transcript: string): LeadObjection[] {
  const text = (transcript || "").toLowerCase().trim();
  
  // Return empty array if transcript is empty or invalid
  if (!text) {
    return [];
  }
  
  const objections: LeadObjection[] = [];
  
  // PRICE objections - detect concerns about cost and affordability
  const priceKeywords = ["too expensive", "budget", "cost", "price high"];
  if (priceKeywords.some((keyword) => text.includes(keyword))) {
    objections.push("PRICE");
  }
  
  // LOCATION objections - detect concerns about distance and area
  const locationKeywords = ["far", "location", "area", "distance"];
  if (locationKeywords.some((keyword) => text.includes(keyword))) {
    objections.push("LOCATION");
  }
  
  // TRUST objections - detect concerns about credibility and reliability
  const trustKeywords = ["builder", "trust", "reviews", "reliable", "delivery"];
  if (trustKeywords.some((keyword) => text.includes(keyword))) {
    objections.push("TRUST");
  }
  
  // TIMING objections - detect concerns about timing and readiness
  const timingKeywords = ["later", "not now", "after", "next year"];
  if (timingKeywords.some((keyword) => text.includes(keyword))) {
    objections.push("TIMING");
  }
  
  // FINANCING objections - detect concerns about loans and financial assistance
  const financingKeywords = ["loan", "emi", "bank", "finance"];
  if (financingKeywords.some((keyword) => text.includes(keyword))) {
    objections.push("FINANCING");
  }
  
  // Return unique objections only (normalized to uppercase)
  return [...new Set(objections)];
}

/**
 * Emotion types detected from conversation.
 */
export type Emotion = "calm" | "excited" | "anxious" | "frustrated" | "confused";

/**
 * Urgency level classification.
 */
export type UrgencyLevel = "low" | "medium" | "high";

/**
 * Emotion and urgency detection result.
 */
export interface EmotionAndUrgency {
  emotion: Emotion;
  urgencyLevel: UrgencyLevel;
  urgencyReason: string;
}

/**
 * Script mode types for adaptive AI caller behavior.
 * Each mode represents a different conversation strategy.
 */
export type ScriptMode = "DISCOVERY" | "REASSURANCE" | "CLOSING" | "FAST_TRACK" | "COOL_DOWN";

/**
 * Input for script mode decision.
 */
export interface ScriptModeDecisionInput {
  leadStatus: "HOT" | "WARM" | "COLD" | "NOT_PICK";
  emotion: "calm" | "excited" | "anxious" | "frustrated" | "confused";
  urgencyLevel: "low" | "medium" | "high";
}

/**
 * Decide the appropriate script mode based on lead status, emotion, and urgency.
 * 
 * Decision Rules:
 * - HOT + high urgency → FAST_TRACK (urgent, high-value leads need immediate action)
 * - HOT + calm/excited → CLOSING (ready leads need conversion push)
 * - WARM + anxious → REASSURANCE (worried leads need comfort before proceeding)
 * - WARM + calm → DISCOVERY (moderate interest needs exploration)
 * - Any frustrated → COOL_DOWN (frustrated leads need de-escalation)
 * - COLD → DISCOVERY (light) (low interest needs gentle exploration)
 * 
 * @param input - ScriptModeDecisionInput with leadStatus, emotion, and urgencyLevel
 * @returns ScriptMode indicating the conversation strategy to use
 */
export function decideScriptMode(input: ScriptModeDecisionInput): ScriptMode {
  const { leadStatus, emotion, urgencyLevel } = input;
  
  // Rule 1: Any frustrated lead → COOL_DOWN (highest priority - de-escalate first)
  if (emotion === "frustrated") {
    return "COOL_DOWN";
  }
  
  // Rule 2: HOT + high urgency → FAST_TRACK
  if (leadStatus === "HOT" && urgencyLevel === "high") {
    return "FAST_TRACK";
  }
  
  // Rule 3: HOT + calm/excited → CLOSING
  if (leadStatus === "HOT" && (emotion === "calm" || emotion === "excited")) {
    return "CLOSING";
  }
  
  // Rule 4: WARM + anxious → REASSURANCE
  if (leadStatus === "WARM" && emotion === "anxious") {
    return "REASSURANCE";
  }
  
  // Rule 5: WARM + calm → DISCOVERY
  if (leadStatus === "WARM" && emotion === "calm") {
    return "DISCOVERY";
  }
  
  // Rule 6: COLD → DISCOVERY (light)
  if (leadStatus === "COLD") {
    return "DISCOVERY";
  }
  
  // Rule 7: NOT_PICK → DISCOVERY (light)
  if (leadStatus === "NOT_PICK") {
    return "DISCOVERY";
  }
  
  // Default fallback: DISCOVERY for any unhandled combinations
  return "DISCOVERY";
}

/**
 * Objection strategy types for dynamic reply generation.
 * Each strategy represents a different approach to handling specific objections.
 */
export type ObjectionStrategy = "VALUE_REFRAME" | "SOCIAL_PROOF" | "CONTEXTUAL_COMPARE" | "SOFT_URGENCY" | "ASSISTIVE" | "SIMPLIFY";

/**
 * Decide objection handling strategy based on primary objection.
 * 
 * Strategy Mapping:
 * - PRICE → VALUE_REFRAME (reframe cost as investment, ROI, appreciation)
 * - TRUST → SOCIAL_PROOF (builder credibility, past buyers, testimonials)
 * - LOCATION → CONTEXTUAL_COMPARE (compare with nearby options, highlight advantages)
 * - TIMING → SOFT_URGENCY (limited availability, low-pressure urgency)
 * - FINANCING → ASSISTIVE (EMI options, payment plans, eligibility help)
 * - CONFUSION → SIMPLIFY (explain in very simple language, break down concepts)
 * - null → No specific strategy (use default approach)
 * 
 * @param primaryObjection - The primary objection detected (or null)
 * @returns ObjectionStrategy indicating how to handle the objection
 */
export function decideObjectionStrategy(primaryObjection: PrimaryObjection): ObjectionStrategy | null {
  if (!primaryObjection) {
    return null;
  }
  
  switch (primaryObjection) {
    case "PRICE":
      return "VALUE_REFRAME";
    case "TRUST":
      return "SOCIAL_PROOF";
    case "LOCATION":
      return "CONTEXTUAL_COMPARE";
    case "TIMING":
      return "SOFT_URGENCY";
    case "FINANCING":
      return "ASSISTIVE";
    case "CONFUSION":
      return "SIMPLIFY";
    default:
      return null;
  }
}

/**
 * Detect emotion and urgency from transcript and call duration.
 * 
 * Emotion Detection:
 * - calm: Neutral, measured responses, no strong indicators
 * - excited: Positive enthusiasm, eager language, quick responses
 * - anxious: Worry indicators, uncertainty, hesitation
 * - frustrated: Negative language, impatience, complaints
 * - confused: Questions about basics, seeking clarification
 * 
 * Urgency Detection:
 * - high: Immediate action needed, time-sensitive language, short duration with high engagement
 * - medium: Moderate interest with some time pressure
 * - low: Casual inquiry, no time pressure, exploratory
 * 
 * @param transcript - The conversation transcript
 * @param durationSeconds - Call duration in seconds
 * @returns EmotionAndUrgency object with detected emotion, urgency level, and reason
 */
export function detectEmotionAndUrgency(transcript: string, durationSeconds: number): EmotionAndUrgency {
  const text = (transcript || "").toLowerCase().trim();
  const duration = durationSeconds || 0;
  
  // Default values
  let emotion: Emotion = "calm";
  let urgencyLevel: UrgencyLevel = "low";
  let urgencyReason = "Standard inquiry with no time pressure";
  
  // Emotion detection keywords
  const excitedKeywords = [
    "excited", "great", "wonderful", "amazing", "perfect", "love it", "yes please",
    "definitely", "absolutely", "sounds good", "interested", "want to", "ready"
  ];
  const anxiousKeywords = [
    "worried", "concerned", "not sure", "doubt", "hesitant", "uncertain", "maybe",
    "think about", "need to check", "not decided", "worried about"
  ];
  const frustratedKeywords = [
    "frustrated", "annoyed", "tired", "fed up", "not happy", "disappointed",
    "problem", "issue", "complaint", "not working", "bad experience"
  ];
  const confusedKeywords = [
    "confused", "don't understand", "not clear", "what do you mean", "explain",
    "can you clarify", "not sure what", "how does", "what is"
  ];
  
  // Count emotion indicators
  const excitedCount = excitedKeywords.filter((kw) => text.includes(kw)).length;
  const anxiousCount = anxiousKeywords.filter((kw) => text.includes(kw)).length;
  const frustratedCount = frustratedKeywords.filter((kw) => text.includes(kw)).length;
  const confusedCount = confusedKeywords.filter((kw) => text.includes(kw)).length;
  
  // Determine emotion (prioritize negative emotions if present)
  if (frustratedCount >= 2) {
    emotion = "frustrated";
  } else if (confusedCount >= 2) {
    emotion = "confused";
  } else if (anxiousCount >= 2) {
    emotion = "anxious";
  } else if (excitedCount >= 3) {
    emotion = "excited";
  } else {
    emotion = "calm";
  }
  
  // Urgency detection
  const urgencyKeywords = [
    "urgent", "asap", "as soon as possible", "immediately", "right now", "today",
    "tomorrow", "this week", "need it", "quickly", "fast", "hurry", "time sensitive"
  ];
  const hasUrgencyKeywords = urgencyKeywords.some((kw) => text.includes(kw));
  
  // High urgency indicators
  if (hasUrgencyKeywords || (duration < 60 && excitedCount >= 2)) {
    urgencyLevel = "high";
    if (hasUrgencyKeywords) {
      urgencyReason = "Explicit urgency indicators in conversation";
    } else {
      urgencyReason = "High engagement in short call duration";
    }
  }
  // Medium urgency indicators
  else if (duration >= 60 && duration < 180 && (excitedCount >= 1 || anxiousCount >= 1)) {
    urgencyLevel = "medium";
    urgencyReason = "Moderate engagement with some time sensitivity";
  }
  // Low urgency (default)
  else {
    urgencyLevel = "low";
    if (duration < 30) {
      urgencyReason = "Very short call with minimal engagement";
    } else if (confusedCount >= 1) {
      urgencyReason = "Exploratory conversation with clarification needed";
    } else {
      urgencyReason = "Standard inquiry with no time pressure";
    }
  }
  
  return {
    emotion,
    urgencyLevel,
    urgencyReason,
  };
}

/**
 * Detect primary objection from transcript.
 * Identifies the most prominent objection or confusion signal.
 * 
 * Detection Priority:
 * 1. CONFUSION: Basic clarifying questions, "don't understand", "explain"
 * 2. Detected objections (PRICE, TRUST, LOCATION, TIMING, FINANCING) - first one found
 * 3. null if no clear objection
 * 
 * @param transcript - The conversation transcript
 * @param detectedObjections - Array of objections already detected
 * @returns PrimaryObjection or null
 */
export function detectPrimaryObjection(transcript: string, detectedObjections: LeadObjection[]): PrimaryObjection {
  const text = (transcript || "").toLowerCase().trim();
  
  // Check for CONFUSION first (highest priority)
  const confusionKeywords = [
    "don't understand", "don't know", "not clear", "confused", "what do you mean",
    "can you explain", "explain to me", "not sure what", "how does this work",
    "what is", "what are", "tell me more", "i don't get it"
  ];
  if (confusionKeywords.some((keyword) => text.includes(keyword))) {
    return "CONFUSION";
  }
  
  // Return first detected objection (priority order: PRICE, TRUST, LOCATION, TIMING, FINANCING)
  if (detectedObjections.length > 0) {
    // Priority order for primary objection selection
    const priorityOrder: LeadObjection[] = ["PRICE", "TRUST", "LOCATION", "TIMING", "FINANCING"];
    for (const objection of priorityOrder) {
      if (detectedObjections.includes(objection)) {
        return objection;
      }
    }
    // If not in priority order, return first one
    return detectedObjections[0] as PrimaryObjection;
  }
  
  return null;
}

/**
 * Extract conversation memory data from transcript.
 * Combines all extraction functions to build a complete memory profile.
 * 
 * @param transcript - The conversation transcript
 * @returns ConversationMemory object with extracted data
 */
export function extractConversationMemory(transcript: string): ConversationMemory {
  // Use detectObjections for structured objection detection
  // This provides focused detection based on explicit keywords
  const detectedObjections = detectObjections(transcript);
  
  // Detect primary objection for strategy selection
  const primaryObjection = detectPrimaryObjection(transcript, detectedObjections);
  
  return {
    questions: extractQuestions(transcript),
    objections: detectedObjections,
    sentiment: extractSentiment(transcript),
    preferredLanguage: detectPreferredLanguage(transcript),
    primaryObjection,
  };
}

/**
 * Get AI tone context based on lead status and sentiment trend.
 * This determines how the AI caller should communicate with the lead.
 * 
 * Tone Selection Logic:
 * - NOT_PICK: Lead hasn't responded yet → be polite & brief to avoid annoyance
 * - COLD: Low interest → be informational to build trust without pushing
 * - WARM: Moderate interest → be friendly & persuasive to encourage engagement
 * - HOT: High interest → be confident & closing-focused to convert
 * 
 * Negative Sentiment Adjustment:
 * - If sentiment trend shows negative signals, reduce pushiness and increase reassurance
 * - This prevents further alienating leads who may be frustrated
 * 
 * @param status - Current lead status (NOT_PICK, COLD, WARM, HOT)
 * @param sentimentTrend - Array of sentiment readings from recent calls (latest first)
 * @returns Tone context string for AI prompt generation
 */
export function getAIToneContext(
  status: LeadStatus,
  sentimentTrend: string[] = []
): string {
  // Check if recent sentiment trend shows negative signals
  // Look at last 3 sentiment readings to detect trend
  const recentSentiments = sentimentTrend.slice(0, 3);
  const hasNegativeTrend = recentSentiments.filter((s) => s === "negative").length >= 2;

  // Base tone selection based on lead status
  let baseTone: string;
  
  switch (status) {
    case "NOT_PICK":
      // Lead hasn't responded yet - keep it brief and polite to avoid being annoying
      baseTone = "polite & brief";
      break;
      
    case "COLD":
      // Low interest - focus on information and building trust, avoid being pushy
      baseTone = "informational";
      break;
      
    case "WARM":
      // Moderate interest - be friendly and persuasive to encourage engagement
      baseTone = "friendly & persuasive";
      break;
      
    case "HOT":
      // High interest - be confident and focus on closing the deal
      baseTone = "confident & closing-focused";
      break;
      
    default:
      // Fallback to informational if status is unknown
      baseTone = "informational";
  }

  // Adjust tone if negative sentiment trend is detected
  if (hasNegativeTrend) {
    // Reduce pushiness and increase reassurance when lead shows negative sentiment
    // This prevents further alienating leads who may be frustrated or annoyed
    return `${baseTone}, but reduce pushiness and increase reassurance language. Be empathetic and acknowledge any concerns.`;
  }

  return baseTone;
}

/**
 * Get AI response strategy guidance for each objection type.
 * These are suggestions passed to the AI, not hardcoded responses.
 * 
 * Objection Handling Flow:
 * 1. Detect objections from transcript using extractObjections()
 * 2. Store in CampaignContact.objections (deduplicated)
 * 3. Map objection type to handling strategy using this function
 * 4. Include strategy in AI prompt as guidance via generateObjectionHandlingGuidance()
 * 5. AI generates natural response using the strategy when objection comes up
 * 
 * @param objectionType - The objection type (PRICE, LOCATION, TRUST, TIMING, FINANCING)
 * @returns Strategy guidance string for AI prompt
 */
export function getObjectionHandlingStrategy(objectionType: ObjectionType): string {
  switch (objectionType) {
    case "PRICE":
      // For price objections, guide AI to explain EMI options and value proposition
      return "explain EMI options, payment plans, and value proposition (quality, amenities, location benefits)";
      
    case "LOCATION":
      // For location objections, guide AI to highlight connectivity and nearby landmarks
      return "highlight connectivity (metro, highways, transport), nearby landmarks, schools, hospitals, and area development plans";
      
    case "TRUST":
      // For trust objections, guide AI to establish developer credibility
      return "establish credibility by mentioning developer track record, RERA registration, certifications, past projects, and customer testimonials";
      
    case "TIMING":
      // For timing objections, guide AI to offer flexible site visits
      return "offer flexible site visit scheduling, mention that you're available at their convenience, and avoid pushing for immediate decisions";
      
    case "FINANCING":
      // For financing objections, guide AI to offer loan assistance
      return "explain available loan assistance, tie-up banks, EMI calculator options, down payment flexibility, and financing process guidance";
      
    default:
      return "address the concern empathetically and provide relevant information";
  }
}

/**
 * Generate objection handling guidance string for AI prompt.
 * This combines all detected objections with their handling strategies.
 * 
 * Flow:
 * - If objections exist, this generates structured guidance for each one
 * - Guidance tells AI what approach to take (not hardcoded responses)
 * - AI uses this guidance to generate natural, contextual responses
 * 
 * @param objections - Array of objection types detected
 * @returns Combined guidance string for AI prompt, or empty string if no objections
 */
export function generateObjectionHandlingGuidance(objections: ObjectionType[]): string {
  if (!objections || objections.length === 0) {
    return "";
  }

  // Build guidance string for each objection
  // Format: "OBJECTION_TYPE: strategy guidance"
  const guidanceParts = objections.map((objection) => {
    const strategy = getObjectionHandlingStrategy(objection);
    return `${objection}: ${strategy}`;
  });

  // Return combined guidance string
  // This tells AI what to do when these objections come up in conversation
  return `The lead has raised the following objections that need to be addressed: ${guidanceParts.join("; ")}. When these topics come up in conversation, use the suggested approach naturally.`;
}

/**
 * Generate AI prompt with tone context for call script or response generation.
 * This function prepares the system message that includes tone instructions and objection handling.
 * 
 * Prompt Construction Flow:
 * 1. Start with base role and tone context (from getAIToneContext)
 * 2. Add conversation memory (questions, objections, language)
 * 3. Add objection handling guidance if objections exist (via generateObjectionHandlingGuidance)
 * 4. Add property information
 * 5. Finalize with response style instructions
 * 
 * Objection Handling Integration:
 * - If objections exist in conversationMemory, generate structured guidance
 * - Guidance tells AI what approach to take, not what exact words to say
 * - AI generates natural responses using the guidance when objections arise
 * - This ensures objections are addressed directly while maintaining natural conversation flow
 * 
 * Usage: Import this when building OpenAI prompts for Twilio calls or AI responses.
 * 
 * @param status - Current lead status
 * @param sentimentTrend - Array of sentiment readings from recent calls
 * @param propertyInfo - Optional property information for context
 * @param conversationMemory - Optional conversation memory for personalization
 * @returns System message string with tone context and objection handling for AI prompt
 */
export function generateAIPromptWithTone(
  status: LeadStatus,
  sentimentTrend: string[] = [],
  propertyInfo?: string,
  conversationMemory?: ConversationMemory,
  handoffRecommended?: boolean,
  handoffReason?: string | null,
  scriptMode?: ScriptMode,
  objectionStrategy?: ObjectionStrategy | null,
  campaignKnowledge?: {
    priceRange?: string;
    amenities?: string[];
    location?: string;
    possession?: string;
    highlights?: string[];
  } | null,
  voiceKnowledge?: {
    safeTalkingPoints?: string[];
    idealBuyerProfile?: string;
    objectionsLikely?: string[];
    pricingConfidence?: 'LOW' | 'MEDIUM' | 'HIGH';
    doNotSay?: string[];
  } | null,
  knowledgeUsageMode?: 'INTERNAL_ONLY' | 'PUBLIC'
): string {
  // Get the appropriate tone context based on status and sentiment
  const toneContext = getAIToneContext(status, sentimentTrend);

  // Build system message with tone instructions
  let systemMessage = `You are a professional real estate sales agent making a follow-up call. `;
  systemMessage += `Communication tone: ${toneContext}. `;

  // Inject campaign knowledge base if available
  if (campaignKnowledge) {
    systemMessage += `\n\nYou may ONLY use the following property information when answering questions:\n`;
    
    if (campaignKnowledge.priceRange) {
      systemMessage += `- Price Range: ${campaignKnowledge.priceRange}\n`;
    }
    if (campaignKnowledge.location) {
      systemMessage += `- Location: ${campaignKnowledge.location}\n`;
    }
    if (campaignKnowledge.possession) {
      systemMessage += `- Possession: ${campaignKnowledge.possession}\n`;
    }
    if (campaignKnowledge.amenities && campaignKnowledge.amenities.length > 0) {
      systemMessage += `- Amenities: ${campaignKnowledge.amenities.join(', ')}\n`;
    }
    if (campaignKnowledge.highlights && campaignKnowledge.highlights.length > 0) {
      systemMessage += `- Highlights: ${campaignKnowledge.highlights.join(', ')}\n`;
    }
    
    systemMessage += `\nIMPORTANT: If the lead asks about something NOT mentioned in the above information, you must politely defer and say you don't have that information available. Do NOT guess or make up information. `;
  }

  // Add script mode instructions for adaptive behavior
  if (scriptMode) {
    switch (scriptMode) {
      case "DISCOVERY":
        systemMessage += `Script Mode: DISCOVERY - Ask open-ended questions to understand the lead's needs, preferences, and current situation. Focus on learning about their requirements rather than pushing for immediate action. Be curious and exploratory. `;
        break;
      case "REASSURANCE":
        systemMessage += `Script Mode: REASSURANCE - Reduce pressure and address fears or concerns. Be empathetic, patient, and supportive. Focus on building trust and addressing objections gently. Avoid being pushy. `;
        break;
      case "CLOSING":
        systemMessage += `Script Mode: CLOSING - Push for site visit or booking. Be confident and direct in asking for next steps. Offer concrete actions like scheduling a visit, sending booking details, or discussing payment plans. `;
        break;
      case "FAST_TRACK":
        systemMessage += `Script Mode: FAST_TRACK - This is an urgent, high-value lead. Create urgency-based call-to-action. Emphasize limited availability, special offers, or immediate benefits. Move quickly toward booking or site visit scheduling. `;
        break;
      case "COOL_DOWN":
        systemMessage += `Script Mode: COOL_DOWN - The lead seems frustrated. Be polite, apologetic if needed, and offer to reschedule or exit gracefully. Do not push for sales. Focus on de-escalation and maintaining relationship. Offer to call back later. `;
        break;
    }
  }

  // Add context about lead's previous questions if available
  // This helps AI understand what topics the lead is interested in
  if (conversationMemory?.questions && conversationMemory.questions.length > 0) {
    systemMessage += `The lead has previously asked about: ${conversationMemory.questions.join(", ")}. Address these topics naturally. `;
  }

  // Add objection strategy instructions for dynamic reply generation
  // This provides specific guidance on how to handle the primary objection
  if (objectionStrategy) {
    switch (objectionStrategy) {
      case "VALUE_REFRAME":
        systemMessage += `Objection Strategy: VALUE_REFRAME - The lead has price concerns. Reframe the cost as an investment. Explain ROI, property appreciation potential, long-term value, and benefits that justify the price. Focus on value proposition rather than just the number. `;
        break;
      case "SOCIAL_PROOF":
        systemMessage += `Objection Strategy: SOCIAL_PROOF - The lead has trust concerns. Build credibility by mentioning builder track record, past successful projects, customer testimonials, RERA registration, certifications, and delivery history. Use social proof to establish trust. `;
        break;
      case "CONTEXTUAL_COMPARE":
        systemMessage += `Objection Strategy: CONTEXTUAL_COMPARE - The lead has location concerns. Compare this property with nearby options. Highlight advantages: better connectivity, proximity to landmarks, infrastructure development, future growth potential, and area benefits. `;
        break;
      case "SOFT_URGENCY":
        systemMessage += `Objection Strategy: SOFT_URGENCY - The lead has timing concerns. Create gentle urgency by mentioning limited availability, good units getting booked, but keep it low-pressure. Emphasize benefits of acting now without being pushy. `;
        break;
      case "ASSISTIVE":
        systemMessage += `Objection Strategy: ASSISTIVE - The lead has financing concerns. Offer assistance with EMI options, payment plans, down payment flexibility, loan eligibility help, tie-up banks, and financing process guidance. Be helpful and supportive. `;
        break;
      case "SIMPLIFY":
        systemMessage += `Objection Strategy: SIMPLIFY - The lead seems confused. Explain everything in very simple language. Break down complex concepts. Use analogies if helpful. Avoid jargon. Make sure they understand each point before moving forward. `;
        break;
    }
  }

  // Add objection handling guidance if objections exist (legacy support)
  // This is the key part: if objections were detected and stored, provide structured guidance
  // The AI will use this guidance to generate appropriate responses when objections come up
  if (conversationMemory?.objections && conversationMemory.objections.length > 0) {
    // Normalize objections to uppercase ObjectionType format
    // Handle both old lowercase format and new uppercase format for backward compatibility
    const normalizedObjections = conversationMemory.objections
      .map((obj) => (typeof obj === "string" ? obj.toUpperCase() : obj))
      .filter((obj): obj is ObjectionType => 
        ["PRICE", "LOCATION", "TRUST", "TIMING", "FINANCING"].includes(obj as string)
      ) as ObjectionType[];
    
    if (normalizedObjections.length > 0 && !objectionStrategy) {
      // Only add legacy guidance if no objection strategy is set (to avoid duplication)
      // Generate structured objection handling guidance
      // This tells AI what approach to take for each objection, not hardcoded responses
      const objectionGuidance = generateObjectionHandlingGuidance(normalizedObjections);
      systemMessage += `${objectionGuidance} `;
    }
  }

  // Add language preference and style instructions if detected
  // This ensures AI responds in the same language style as the user
  if (conversationMemory?.preferredLanguage) {
    const lang = conversationMemory.preferredLanguage;
    
    if (lang === "hi") {
      // Pure Hindi: Respond in Hindi
      systemMessage += `The lead prefers to communicate in Hindi. Respond in Hindi (Devanagari script or English transliteration). `;
    } else if (lang === "hinglish") {
      // Hinglish: Mix English and Hindi naturally
      // Common pattern: English nouns (property, price, location) + Hindi verbs and particles
      systemMessage += `The lead prefers Hinglish (mixed Hindi-English). Respond by naturally mixing English and Hindi: use English for technical terms (property, price, location, EMI, etc.) and Hindi for verbs and conversational particles. Match their style naturally. `;
    } else {
      // English (default): Respond in English
      systemMessage += `The lead prefers to communicate in English. Respond in English. `;
    }
  }

  // Add property information if provided
  if (propertyInfo) {
    systemMessage += `Property details: ${propertyInfo}. `;
  }

  // Add human handoff messaging instruction if handoff is recommended
  // This ensures AI informs user about human advisor call when handoff is triggered
  if (handoffRecommended && handoffReason) {
    // Import handoff messaging function dynamically to avoid circular dependency
    // The instruction tells AI to inform user about human advisor call in respectful, confident tone
    const { generateHandoffMessagingInstruction } = require("./handoffDecision");
    const handoffInstruction = generateHandoffMessagingInstruction(
      handoffReason as any,
      conversationMemory?.preferredLanguage
    );
    systemMessage += `IMPORTANT - Human Handoff Required: ${handoffInstruction} `;
  }

  // Inject voice knowledge (INTERNAL USE ONLY - for scoring, objection detection, follow-up planning)
  // IMPORTANT: This knowledge is for internal AI decision-making only, NOT for speaking to leads
  if (voiceKnowledge && knowledgeUsageMode === 'INTERNAL_ONLY') {
    systemMessage += `\n\nINTERNAL KNOWLEDGE BASE (DO NOT SPEAK THESE DIRECTLY TO LEADS - USE FOR DECISION MAKING ONLY):\n`;
    
    if (voiceKnowledge.safeTalkingPoints && voiceKnowledge.safeTalkingPoints.length > 0) {
      systemMessage += `- Safe Talking Points (you may reference these naturally, but do not quote verbatim): ${voiceKnowledge.safeTalkingPoints.join('; ')}\n`;
    }
    if (voiceKnowledge.idealBuyerProfile) {
      systemMessage += `- Ideal Buyer Profile (use for lead scoring and qualification): ${voiceKnowledge.idealBuyerProfile}\n`;
    }
    if (voiceKnowledge.objectionsLikely && voiceKnowledge.objectionsLikely.length > 0) {
      systemMessage += `- Likely Objections (be prepared to handle): ${voiceKnowledge.objectionsLikely.join(', ')}\n`;
    }
    if (voiceKnowledge.pricingConfidence) {
      systemMessage += `- Pricing Confidence Level: ${voiceKnowledge.pricingConfidence} (use for pricing discussions)\n`;
    }
    if (voiceKnowledge.doNotSay && voiceKnowledge.doNotSay.length > 0) {
      systemMessage += `- DO NOT SAY (strictly avoid these phrases): ${voiceKnowledge.doNotSay.join(', ')}\n`;
    }
    
    systemMessage += `\nCRITICAL: The above knowledge is for YOUR INTERNAL USE ONLY. Use it to:\n`;
    systemMessage += `- Score leads more accurately\n`;
    systemMessage += `- Detect objections early\n`;
    systemMessage += `- Plan follow-up strategies\n`;
    systemMessage += `- Understand buyer profiles\n`;
    systemMessage += `DO NOT quote the raw transcript or structured knowledge verbatim to leads. Convert insights into natural conversation. `;
  }

  // Final instruction
  systemMessage += `Keep responses natural, conversational, and aligned with the specified tone.`;

  return systemMessage;
}
