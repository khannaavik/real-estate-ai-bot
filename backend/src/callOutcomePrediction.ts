// backend/src/callOutcomePrediction.ts
// Deterministic and explainable call outcome prediction system

/**
 * Call outcome prediction result.
 * Provides probability score, bucket classification, confidence level, reasoning, and recommendations.
 */
export type CallOutcomePrediction = {
  probabilityScore: number; // 0–100
  bucket: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning: string[];
  recommendedAction: 'DROP' | 'NURTURE' | 'FOLLOW_UP' | 'HUMAN_HANDOFF';
  recommendedFollowUp: 'CALL_2H' | 'CALL_24H' | 'CALL_48H' | 'WHATSAPP' | 'EMAIL' | 'NONE';
};

/**
 * Input parameters for call outcome prediction.
 */
export interface CallOutcomePredictionInput {
  status: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';
  durationSeconds: number;
  questionsCount: number;
  objectionsCount: number;
  sentiment: 'negative' | 'neutral' | 'positive';
  followUpChannel?: string;
  followUpAfterHours?: number;
  handoffRecommended?: boolean;
}

/**
 * Predict call outcome based on call metrics and lead status.
 * 
 * This is a fully deterministic scoring system that:
 * - Starts with a base score based on lead status
 * - Applies adjustments based on engagement signals
 * - Maps final score to probability buckets
 * - Provides explainable reasoning for each adjustment
 * 
 * Scoring Logic:
 * Base Score:
 * - HOT = 70
 * - WARM = 45
 * - COLD = 20
 * - NOT_PICK = 5
 * 
 * Adjustments:
 * +15 if durationSeconds >= 120 (long engagement)
 * +10 if questionsCount >= 2 (active interest)
 * -10 if objectionsCount >= 2 (multiple concerns)
 * +10 if sentiment === 'positive' (positive conversation)
 * +15 if handoffRecommended === true (requires human attention)
 * +10 if followUpAfterHours <= 2 (urgent follow-up needed)
 * -5  if followUpChannel === 'WHATSAPP' (lower priority channel)
 * 
 * Final score is clamped between 0 and 100.
 * 
 * @param input - CallOutcomePredictionInput with call metrics
 * @returns CallOutcomePrediction with score, bucket, confidence, reasoning, and recommendations
 */
export function predictCallOutcome(input: CallOutcomePredictionInput): CallOutcomePrediction {
  const {
    status,
    durationSeconds,
    questionsCount,
    objectionsCount,
    sentiment,
    followUpChannel,
    followUpAfterHours,
    handoffRecommended,
  } = input;

  // Start with base score based on lead status
  let score: number;
  const reasoning: string[] = [];
  
  switch (status) {
    case 'HOT':
      score = 70;
      reasoning.push('Base score: 70 (HOT lead status indicates high interest)');
      break;
    case 'WARM':
      score = 45;
      reasoning.push('Base score: 45 (WARM lead status indicates moderate interest)');
      break;
    case 'COLD':
      score = 20;
      reasoning.push('Base score: 20 (COLD lead status indicates low interest)');
      break;
    case 'NOT_PICK':
      score = 5;
      reasoning.push('Base score: 5 (NOT_PICK status indicates no engagement)');
      break;
    default:
      score = 20; // Default to COLD if unknown
      reasoning.push('Base score: 20 (unknown status, defaulting to COLD)');
  }

  // Apply adjustments based on engagement signals
  
  // Long call duration indicates strong engagement
  if (durationSeconds >= 120) {
    score += 15;
    reasoning.push(`+15: Long call duration (${durationSeconds}s) indicates strong engagement`);
  }

  // Multiple questions indicate active interest
  if (questionsCount >= 2) {
    score += 10;
    reasoning.push(`+10: Multiple questions asked (${questionsCount}) shows active interest`);
  }

  // Multiple objections indicate concerns that may reduce conversion
  if (objectionsCount >= 2) {
    score -= 10;
    reasoning.push(`-10: Multiple objections raised (${objectionsCount}) indicates concerns`);
  }

  // Positive sentiment increases probability
  if (sentiment === 'positive') {
    score += 10;
    reasoning.push('+10: Positive sentiment detected in conversation');
  }

  // Handoff recommended indicates high-value lead needing attention
  if (handoffRecommended === true) {
    score += 15;
    reasoning.push('+15: Human handoff recommended indicates high-value lead');
  }

  // Urgent follow-up (within 2 hours) indicates high priority
  if (followUpAfterHours !== undefined && followUpAfterHours <= 2) {
    score += 10;
    reasoning.push(`+10: Urgent follow-up scheduled (${followUpAfterHours}h) indicates high priority`);
  }

  // WhatsApp follow-up indicates lower priority channel (case-insensitive check)
  if (followUpChannel && followUpChannel.toUpperCase() === 'WHATSAPP') {
    score -= 5;
    reasoning.push('-5: WhatsApp follow-up channel suggests lower priority engagement');
  }

  // Clamp score between 0 and 100
  const originalScore = score;
  score = Math.max(0, Math.min(100, score));
  if (originalScore !== score) {
    reasoning.push(`Final score clamped from ${originalScore} to ${score} (range: 0-100)`);
  }

  // Map score to probability bucket
  let bucket: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  if (score >= 85) {
    bucket = 'VERY_HIGH';
  } else if (score >= 65) {
    bucket = 'HIGH';
  } else if (score >= 40) {
    bucket = 'MEDIUM';
  } else if (score >= 20) {
    bucket = 'LOW';
  } else {
    bucket = 'VERY_LOW';
  }

  // Map bucket to recommended action
  let recommendedAction: 'DROP' | 'NURTURE' | 'FOLLOW_UP' | 'HUMAN_HANDOFF';
  switch (bucket) {
    case 'VERY_HIGH':
      recommendedAction = 'HUMAN_HANDOFF';
      break;
    case 'HIGH':
      recommendedAction = 'FOLLOW_UP';
      break;
    case 'MEDIUM':
      recommendedAction = 'NURTURE';
      break;
    case 'LOW':
      recommendedAction = 'NURTURE';
      break;
    case 'VERY_LOW':
      recommendedAction = 'DROP';
      break;
  }

  // Determine confidence level based on engagement metrics
  let confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  if (durationSeconds >= 120 && questionsCount >= 2) {
    confidenceLevel = 'HIGH';
  } else if (durationSeconds >= 45) {
    confidenceLevel = 'MEDIUM';
  } else {
    confidenceLevel = 'LOW';
  }

  // Map recommended follow-up based on score and urgency
  let recommendedFollowUp: 'CALL_2H' | 'CALL_24H' | 'CALL_48H' | 'WHATSAPP' | 'EMAIL' | 'NONE';
  if (bucket === 'VERY_HIGH' || bucket === 'HIGH') {
    if (followUpAfterHours !== undefined && followUpAfterHours <= 2) {
      recommendedFollowUp = 'CALL_2H';
    } else {
      recommendedFollowUp = 'CALL_24H';
    }
  } else if (bucket === 'MEDIUM') {
    recommendedFollowUp = 'CALL_48H';
  } else if (bucket === 'LOW') {
    recommendedFollowUp = 'WHATSAPP';
  } else {
    recommendedFollowUp = 'NONE';
  }

  return {
    probabilityScore: score,
    bucket,
    confidenceLevel,
    reasoning,
    recommendedAction,
    recommendedFollowUp,
  };
}

