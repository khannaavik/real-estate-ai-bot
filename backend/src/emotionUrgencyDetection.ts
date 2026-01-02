// backend/src/emotionUrgencyDetection.ts
// Deterministic emotion and urgency detection with script mode selection

/**
 * Simple emotion and urgency detection result.
 * Used for basic transcript + duration analysis.
 */
export interface SimpleEmotionUrgencyResult {
  emotion: 'calm' | 'excited' | 'frustrated' | 'hesitant';
  urgencyLevel: 'low' | 'medium' | 'high';
  urgencyReason: string;
}

/**
 * Input for emotion and urgency detection.
 */
export interface EmotionUrgencyDetectionInput {
  transcript: string;
  durationSeconds: number;
  objections: string[];
  outcomeBucket: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
}

/**
 * Output from emotion and urgency detection.
 */
export interface EmotionUrgencyDetectionOutput {
  emotion: 'calm' | 'excited' | 'frustrated' | 'hesitant';
  urgencyLevel: 'low' | 'medium' | 'high';
  urgencyReason: string;
  scriptMode: 'DISCOVERY' | 'OBJECTION' | 'CLOSING';
}

/**
 * Detect emotion and urgency from transcript and duration using deterministic keyword + duration logic.
 * 
 * This is a simple, rule-based detection system that analyzes:
 * - Transcript keywords for emotional signals
 * - Call duration for engagement indicators
 * 
 * Emotion Detection Rules:
 * - excited: Keywords like "interested", "when can we", "book", "visit", "ready to"
 * - frustrated: Keywords like "too expensive", "not sure", "confused", "don't understand", "problem"
 * - hesitant: Conditional phrases ("maybe", "later", "thinking", "need to think", "not decided")
 * - calm: Default if no strong indicators
 * 
 * Urgency Detection Rules:
 * - HIGH: Long duration (>= 120s) with excited keywords OR explicit urgency phrases
 * - MEDIUM: Medium duration (45-119s) with engagement OR some urgency indicators
 * - LOW: Short duration (< 45s) OR no strong engagement signals
 * 
 * @param transcript - The conversation transcript
 * @param durationSeconds - Call duration in seconds
 * @returns SimpleEmotionUrgencyResult with detected emotion, urgency level, and reason
 */
export function detectEmotionAndUrgency(transcript: string, durationSeconds: number): SimpleEmotionUrgencyResult {
  const text = (transcript || "").toLowerCase().trim();
  const duration = durationSeconds || 0;
  
  // Emotion detection keywords
  const excitedKeywords = [
    "interested", "when can we", "book", "visit", "schedule", "ready to",
    "let's proceed", "let us proceed", "yes please", "definitely", "absolutely",
    "sounds good", "want to", "excited", "great", "perfect", "love it"
  ];
  
  const frustratedKeywords = [
    "too expensive", "not sure", "confused", "don't understand", "don't know",
    "not clear", "problem", "issue", "complaint", "annoyed", "tired of",
    "frustrated", "disappointed", "not happy"
  ];
  
  const hesitantKeywords = [
    "maybe", "later", "thinking", "need to think", "not decided", "hesitant",
    "uncertain", "not sure yet", "will think", "consider", "might", "probably"
  ];
  
  // Count keyword matches
  const hasExcitedKeywords = excitedKeywords.some(keyword => text.includes(keyword));
  const hasFrustratedKeywords = frustratedKeywords.some(keyword => text.includes(keyword));
  const hasHesitantKeywords = hesitantKeywords.some(keyword => text.includes(keyword));
  
  // Determine emotion (priority: frustrated > excited > hesitant > calm)
  let emotion: 'calm' | 'excited' | 'frustrated' | 'hesitant' = 'calm';
  let emotionReason = "No strong emotional indicators detected";
  
  if (hasFrustratedKeywords) {
    emotion = 'frustrated';
    emotionReason = "Frustrated keywords detected in transcript";
  } else if (hasExcitedKeywords) {
    emotion = 'excited';
    emotionReason = "Excited keywords detected indicating strong interest";
  } else if (hasHesitantKeywords) {
    emotion = 'hesitant';
    emotionReason = "Hesitant keywords detected indicating uncertainty";
  } else {
    emotion = 'calm';
    emotionReason = "No strong emotional indicators, defaulting to calm";
  }
  
  // Urgency detection based on duration and keywords
  let urgencyLevel: 'low' | 'medium' | 'high';
  let urgencyReason: string;
  
  // Check for explicit urgency keywords
  const urgencyKeywords = [
    "urgent", "asap", "as soon as possible", "immediately", "right now", "today",
    "tomorrow", "this week", "need it", "quickly", "fast", "hurry"
  ];
  const hasUrgencyKeywords = urgencyKeywords.some(keyword => text.includes(keyword));
  
  // High urgency: long duration with engagement OR explicit urgency keywords
  if (hasUrgencyKeywords || (duration >= 120 && hasExcitedKeywords)) {
    urgencyLevel = 'high';
    urgencyReason = hasUrgencyKeywords 
      ? "Explicit urgency indicators in conversation"
      : "Long call duration with strong engagement signals";
  }
  // Medium urgency: medium duration with some engagement
  else if (duration >= 45 && (hasExcitedKeywords || hasHesitantKeywords)) {
    urgencyLevel = 'medium';
    urgencyReason = "Moderate call duration with engagement indicators";
  }
  // Low urgency: short duration or no engagement
  else {
    urgencyLevel = 'low';
    if (duration < 45) {
      urgencyReason = "Short call duration with minimal engagement";
    } else {
      urgencyReason = "Standard inquiry with no time pressure";
    }
  }
  
  return {
    emotion,
    urgencyLevel,
    urgencyReason: `${urgencyReason}. ${emotionReason}.`,
  };
}

/**
 * Detect emotion and urgency from transcript, objections, and outcome bucket (context-aware version).
 * 
 * This is a rule-based, deterministic detection system that analyzes:
 * - Transcript keywords for emotional signals
 * - Objection count for frustration indicators
 * - Outcome bucket for urgency assessment
 * - Combined signals for script mode selection
 * 
 * Emotion Detection Rules:
 * - excited: Keywords like "interested", "when can we", "book", "visit"
 * - frustrated: 2+ objections OR keywords like "too expensive", "not sure", "confused"
 * - hesitant: Conditional phrases ("maybe", "later", "thinking", "need to think")
 * - calm: Default if no strong indicators
 * 
 * Urgency Detection Rules:
 * - HIGH: outcomeBucket is HIGH or VERY_HIGH
 * - MEDIUM: outcomeBucket is MEDIUM
 * - LOW: outcomeBucket is LOW or VERY_LOW
 * 
 * Script Mode Selection:
 * - CLOSING: HIGH urgency AND excited emotion
 * - OBJECTION: 1+ objections OR frustrated emotion
 * - DISCOVERY: Default (all other cases)
 * 
 * @param input - EmotionUrgencyDetectionInput with transcript, duration, objections, and outcome bucket
 * @returns EmotionUrgencyDetectionOutput with detected emotion, urgency, reason, and script mode
 */
export function detectEmotionAndUrgencyWithContext(input: EmotionUrgencyDetectionInput): EmotionUrgencyDetectionOutput {
  const { transcript, durationSeconds, objections, outcomeBucket } = input;
  
  const text = (transcript || "").toLowerCase().trim();
  const objectionsCount = objections?.length || 0;
  
  // Emotion detection
  let emotion: 'calm' | 'excited' | 'frustrated' | 'hesitant' = 'calm';
  let emotionReason = "No strong emotional indicators detected";
  
  // Check for excited keywords
  const excitedKeywords = [
    "interested", "when can we", "book", "visit", "schedule", "ready to",
    "let's proceed", "let us proceed", "yes please", "definitely", "absolutely",
    "sounds good", "want to", "excited", "great", "perfect"
  ];
  const hasExcitedKeywords = excitedKeywords.some(keyword => text.includes(keyword));
  
  // Check for frustrated keywords
  const frustratedKeywords = [
    "too expensive", "not sure", "confused", "don't understand", "don't know",
    "not clear", "problem", "issue", "complaint", "annoyed", "tired of"
  ];
  const hasFrustratedKeywords = frustratedKeywords.some(keyword => text.includes(keyword));
  
  // Check for hesitant keywords
  const hesitantKeywords = [
    "maybe", "later", "thinking", "need to think", "not decided", "hesitant",
    "uncertain", "not sure yet", "will think", "consider", "might"
  ];
  const hasHesitantKeywords = hesitantKeywords.some(keyword => text.includes(keyword));
  
  // Determine emotion (priority: frustrated > excited > hesitant > calm)
  if (objectionsCount >= 2 || hasFrustratedKeywords) {
    emotion = 'frustrated';
    emotionReason = objectionsCount >= 2 
      ? `Multiple objections (${objectionsCount}) indicate frustration`
      : "Frustrated keywords detected in transcript";
  } else if (hasExcitedKeywords) {
    emotion = 'excited';
    emotionReason = "Excited keywords detected indicating strong interest";
  } else if (hasHesitantKeywords) {
    emotion = 'hesitant';
    emotionReason = "Hesitant keywords detected indicating uncertainty";
  } else {
    emotion = 'calm';
    emotionReason = "No strong emotional indicators, defaulting to calm";
  }
  
  // Urgency detection based on outcome bucket
  let urgencyLevel: 'low' | 'medium' | 'high';
  let urgencyReason: string;
  
  if (outcomeBucket === 'HIGH' || outcomeBucket === 'VERY_HIGH') {
    urgencyLevel = 'high';
    urgencyReason = `High outcome bucket (${outcomeBucket}) indicates high urgency`;
  } else if (outcomeBucket === 'MEDIUM') {
    urgencyLevel = 'medium';
    urgencyReason = `Medium outcome bucket indicates moderate urgency`;
  } else {
    urgencyLevel = 'low';
    urgencyReason = `Low outcome bucket (${outcomeBucket}) indicates low urgency`;
  }
  
  // Script mode selection
  let scriptMode: 'DISCOVERY' | 'OBJECTION' | 'CLOSING';
  
  if (urgencyLevel === 'high' && emotion === 'excited') {
    scriptMode = 'CLOSING';
  } else if (objectionsCount >= 1 || emotion === 'frustrated') {
    scriptMode = 'OBJECTION';
  } else {
    scriptMode = 'DISCOVERY';
  }
  
  return {
    emotion,
    urgencyLevel,
    urgencyReason: `${urgencyReason}. ${emotionReason}.`,
    scriptMode,
  };
}

