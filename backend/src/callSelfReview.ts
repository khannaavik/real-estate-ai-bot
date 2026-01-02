// backend/src/callSelfReview.ts
// AI Self-Critique - Deterministic post-call review system

/**
 * Input for generating self-review.
 */
export interface CallSelfReviewInput {
  // Call metrics
  durationSeconds: number;
  transcript?: string | null;
  
  // Detected signals
  emotion?: 'calm' | 'excited' | 'frustrated' | 'hesitant' | 'anxious' | null;
  urgencyLevel?: 'low' | 'medium' | 'high' | null;
  objections: string[];
  questionsCount: number;
  
  // Strategy used
  scriptVariant?: string | null;
  voiceTone?: string | null;
  speechRate?: string | null;
  
  // Outcome
  predictedBucket?: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | null;
  actualStatus?: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT' | null;
  outcomeBucket?: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | null;
  
  // Prediction accuracy
  predictionAccuracy?: 'ACCURATE' | 'OVERESTIMATED' | 'UNDERESTIMATED' | null;
}

/**
 * AI Self-Review result.
 */
export interface CallSelfReview {
  // What worked well
  strengths: string[];
  
  // What could improve
  improvements: string[];
  
  // What AI will do differently next time
  nextTimeActions: string[];
  
  // Prediction accuracy analysis
  predictionAccuracy: {
    status: 'ACCURATE' | 'OVERESTIMATED' | 'UNDERESTIMATED';
    explanation: string;
    predictedBucket?: string;
    actualBucket?: string;
  };
  
  // Overall assessment
  overallAssessment: string;
  
  // Key learnings
  keyLearnings: string[];
}

/**
 * Generate AI self-review from call data.
 * Deterministic analysis only - no AI calls.
 * 
 * @param input - CallSelfReviewInput with call metrics and outcomes
 * @returns CallSelfReview with structured critique
 */
export function generateCallSelfReview(input: CallSelfReviewInput): CallSelfReview {
  const {
    durationSeconds,
    emotion,
    urgencyLevel,
    objections,
    questionsCount,
    scriptVariant,
    voiceTone,
    speechRate,
    predictedBucket,
    actualStatus,
    outcomeBucket,
    predictionAccuracy,
  } = input;

  const strengths: string[] = [];
  const improvements: string[] = [];
  const nextTimeActions: string[] = [];
  const keyLearnings: string[] = [];

  // Analyze what worked well
  if (durationSeconds >= 120) {
    strengths.push('Maintained engagement for extended duration, indicating effective conversation flow');
  }

  if (questionsCount >= 2) {
    strengths.push('Successfully encouraged lead to ask multiple questions, showing active interest');
  }

  if (emotion === 'excited' && urgencyLevel === 'high') {
    strengths.push('Detected and responded to high-urgency excited emotion effectively');
  }

  if (objections.length === 0) {
    strengths.push('No major objections raised, indicating smooth conversation');
  } else if (objections.length === 1) {
    strengths.push('Handled objection without escalation, maintaining conversation flow');
  }

  if (voiceTone === 'empathetic' && objections.length > 0) {
    strengths.push('Used empathetic tone appropriately when objections were present');
  }

  if (scriptVariant === 'CLOSING_CONFIDENT' && actualStatus === 'HOT') {
    strengths.push('Applied confident closing strategy effectively for HOT lead');
  }

  // Analyze what could improve
  if (durationSeconds < 30) {
    improvements.push('Call duration was very short - consider improving opening to increase engagement');
  }

  if (objections.length >= 3) {
    improvements.push('Multiple objections raised - could benefit from earlier objection handling strategy');
  }

  if (emotion === 'frustrated' && voiceTone !== 'empathetic') {
    improvements.push('Frustrated emotion detected but empathetic tone was not used - missed opportunity');
  }

  if (urgencyLevel === 'high' && scriptVariant !== 'CLOSING_CONFIDENT') {
    improvements.push('High urgency detected but closing strategy was not applied - could have moved faster');
  }

  if (questionsCount === 0 && durationSeconds >= 60) {
    improvements.push('Long call with no questions - could have been more engaging to encourage interaction');
  }

  if (predictionAccuracy === 'OVERESTIMATED') {
    improvements.push('Prediction was overestimated - need to better assess actual engagement level');
  }

  if (predictionAccuracy === 'UNDERESTIMATED') {
    improvements.push('Prediction was underestimated - missed signals indicating higher interest');
  }

  // Generate next time actions
  if (objections.length >= 2) {
    nextTimeActions.push('For leads with multiple objections, switch to OBJECTION_EMPATHETIC variant earlier');
  }

  if (emotion === 'frustrated') {
    nextTimeActions.push('When frustration is detected, immediately switch to empathetic tone and slow speech rate');
  }

  if (urgencyLevel === 'high' && actualStatus !== 'HOT') {
    nextTimeActions.push('When high urgency is detected but lead remains WARM/COLD, focus on addressing specific concerns');
  }

  if (durationSeconds < 45 && questionsCount === 0) {
    nextTimeActions.push('For short calls with no engagement, try more direct value proposition in opening');
  }

  if (predictionAccuracy === 'OVERESTIMATED') {
    nextTimeActions.push('Improve prediction accuracy by considering objection count more heavily in scoring');
  }

  if (predictionAccuracy === 'UNDERESTIMATED') {
    nextTimeActions.push('Improve prediction accuracy by better detecting subtle engagement signals');
  }

  // Key learnings
  if (objections.includes('PRICE') && actualStatus === 'COLD') {
    keyLearnings.push('Price objections without resolution led to COLD status - need better value framing');
  }

  if (objections.includes('TRUST') && emotion === 'frustrated') {
    keyLearnings.push('Trust objections combined with frustration require immediate empathetic response');
  }

  if (questionsCount >= 3 && actualStatus === 'HOT') {
    keyLearnings.push('High question count (3+) is a strong indicator of HOT lead status');
  }

  if (durationSeconds >= 180 && actualStatus === 'WARM') {
    keyLearnings.push('Very long calls (3+ min) with WARM status suggest need for more direct closing approach');
  }

  // Generate overall assessment
  let overallAssessment = '';
  
  if (actualStatus === 'HOT' && durationSeconds >= 120) {
    overallAssessment = 'This was a successful call. The lead showed strong engagement with multiple questions and a long conversation duration. The strategy effectively moved the lead to HOT status.';
  } else if (actualStatus === 'WARM' && questionsCount >= 2) {
    overallAssessment = 'This call showed moderate success. The lead engaged with questions, but did not reach HOT status. Consider more direct closing approach for similar leads.';
  } else if (actualStatus === 'COLD' && objections.length >= 2) {
    overallAssessment = 'This call faced challenges with multiple objections. The strategy may not have addressed concerns effectively. Consider earlier objection handling for similar situations.';
  } else if (durationSeconds < 45) {
    overallAssessment = 'This call had limited engagement with short duration. The opening may not have captured interest effectively. Consider refining the opening approach.';
  } else {
    overallAssessment = 'This call had mixed results. Some engagement was achieved, but there is room for improvement in strategy selection and execution.';
  }

  // Prediction accuracy analysis
  const accuracyAnalysis = {
    status: predictionAccuracy || 'ACCURATE',
    explanation: getPredictionAccuracyExplanation(predictedBucket, outcomeBucket, actualStatus),
    ...(predictedBucket && { predictedBucket }),
    ...(outcomeBucket && { actualBucket: outcomeBucket }),
  };

  // Ensure we have at least some content in each section
  if (strengths.length === 0) {
    strengths.push('Call completed successfully');
  }

  if (improvements.length === 0) {
    improvements.push('Overall performance was good, minor refinements could enhance results');
  }

  if (nextTimeActions.length === 0) {
    nextTimeActions.push('Continue with current strategy approach');
  }

  if (keyLearnings.length === 0) {
    keyLearnings.push('Standard call pattern observed');
  }

  return {
    strengths,
    improvements,
    nextTimeActions,
    predictionAccuracy: accuracyAnalysis,
    overallAssessment,
    keyLearnings,
  };
}

/**
 * Get prediction accuracy explanation.
 */
function getPredictionAccuracyExplanation(
  predictedBucket: string | null | undefined,
  outcomeBucket: string | null | undefined,
  actualStatus: string | null | undefined
): string {
  if (!predictedBucket || !outcomeBucket) {
    return 'Prediction accuracy cannot be determined - missing prediction or outcome data';
  }

  const bucketOrder = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
  const predictedIndex = bucketOrder.indexOf(predictedBucket);
  const actualIndex = bucketOrder.indexOf(outcomeBucket);

  if (predictedIndex === actualIndex) {
    return `Prediction was accurate: ${predictedBucket} bucket matched actual outcome`;
  } else if (predictedIndex > actualIndex) {
    return `Prediction was overestimated: predicted ${predictedBucket} but actual was ${outcomeBucket}`;
  } else {
    return `Prediction was underestimated: predicted ${predictedBucket} but actual was ${outcomeBucket}`;
  }
}

/**
 * Calculate prediction accuracy status.
 */
export function calculatePredictionAccuracy(
  predictedBucket: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | null | undefined,
  outcomeBucket: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | null | undefined
): 'ACCURATE' | 'OVERESTIMATED' | 'UNDERESTIMATED' | null {
  if (!predictedBucket || !outcomeBucket) {
    return null;
  }

  const bucketOrder = ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'];
  const predictedIndex = bucketOrder.indexOf(predictedBucket);
  const actualIndex = bucketOrder.indexOf(outcomeBucket);

  if (predictedIndex === actualIndex) {
    return 'ACCURATE';
  } else if (predictedIndex > actualIndex) {
    return 'OVERESTIMATED';
  } else {
    return 'UNDERESTIMATED';
  }
}
