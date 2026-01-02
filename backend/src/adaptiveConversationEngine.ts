// backend/src/adaptiveConversationEngine.ts
// Adaptive conversation loop engine for real-time call behavior adaptation

/**
 * Input for adaptive conversation step decision.
 */
export interface AdaptiveConversationStepInput {
  transcriptChunk: string;
  currentEmotion: 'calm' | 'positive' | 'frustrated' | 'angry' | 'confused';
  urgencyLevel: 'low' | 'medium' | 'high';
  objections: string[];
  questionsCount: number;
  durationSeconds: number;
  scriptMode: 'DISCOVERY' | 'PITCH' | 'OBJECTION_HANDLING' | 'CLOSING';
}

/**
 * Output from adaptive conversation step decision.
 */
export interface AdaptiveConversationStepOutput {
  nextScriptMode: 'DISCOVERY' | 'PITCH' | 'OBJECTION_HANDLING' | 'CLOSING';
  nextPromptInstruction: string;
  interruptAllowed: boolean;
  slowDownSpeech: boolean;
  confidenceBoost: boolean;
}

/**
 * Decide the next conversation step based on live call signals.
 * 
 * This is a deterministic decision system that adapts AI call behavior in real-time:
 * 
 * Decision Rules (in priority order):
 * 1. If emotion is frustrated/angry → OBJECTION_HANDLING (highest priority - de-escalate)
 * 2. If objections ≥ 2 → OBJECTION_HANDLING (multiple concerns need addressing)
 * 3. If questions ≥ 3 and urgency ≠ low → PITCH (engaged lead ready for value proposition)
 * 4. If urgency = high and emotion = positive → CLOSING (hot lead ready to convert)
 * 5. Default → DISCOVERY (continue exploring needs)
 * 
 * Additional Behavior Flags:
 * - interruptAllowed: true if lead is frustrated/angry (let them vent)
 * - slowDownSpeech: true if lead is confused or has many objections (give time to process)
 * - confidenceBoost: true if lead is positive with high urgency (reinforce momentum)
 * 
 * @param input - AdaptiveConversationStepInput with current call state
 * @returns AdaptiveConversationStepOutput with next step and behavior flags
 */
export function decideNextConversationStep(
  input: AdaptiveConversationStepInput
): AdaptiveConversationStepOutput {
  const {
    transcriptChunk,
    currentEmotion,
    urgencyLevel,
    objections,
    questionsCount,
    durationSeconds,
    scriptMode,
  } = input;

  const objectionsCount = objections?.length || 0;

  // Rule 1: If emotion is frustrated/angry → OBJECTION_HANDLING (highest priority)
  if (currentEmotion === 'frustrated' || currentEmotion === 'angry') {
    return {
      nextScriptMode: 'OBJECTION_HANDLING',
      nextPromptInstruction: 'Lead is frustrated or angry. Prioritize de-escalation: acknowledge their concerns, apologize if needed, be empathetic, and focus on resolving their issues. Do not push for sales. Offer to help or reschedule if appropriate.',
      interruptAllowed: true, // Let them vent
      slowDownSpeech: true, // Give them time
      confidenceBoost: false,
    };
  }

  // Rule 2: If objections ≥ 2 → OBJECTION_HANDLING
  if (objectionsCount >= 2) {
    return {
      nextScriptMode: 'OBJECTION_HANDLING',
      nextPromptInstruction: `Multiple objections detected (${objectionsCount}). Address each concern systematically: listen carefully, acknowledge the objection, provide relevant information, and check for understanding before moving forward.`,
      interruptAllowed: false,
      slowDownSpeech: true, // Give time to process responses
      confidenceBoost: false,
    };
  }

  // Rule 3: If questions ≥ 3 and urgency ≠ low → PITCH
  if (questionsCount >= 3 && urgencyLevel !== 'low') {
    return {
      nextScriptMode: 'PITCH',
      nextPromptInstruction: 'Lead has asked multiple questions and shows engagement. Transition to value proposition: highlight key benefits, address their specific interests, and create urgency around availability or special offers.',
      interruptAllowed: false,
      slowDownSpeech: false,
      confidenceBoost: true, // Build momentum
    };
  }

  // Rule 4: If urgency = high and emotion = positive → CLOSING
  if (urgencyLevel === 'high' && currentEmotion === 'positive') {
    return {
      nextScriptMode: 'CLOSING',
      nextPromptInstruction: 'High urgency with positive emotion detected. Lead is ready to convert. Push for next steps: schedule site visit, discuss payment plans, or confirm booking. Be confident and direct.',
      interruptAllowed: false,
      slowDownSpeech: false,
      confidenceBoost: true, // Reinforce positive momentum
    };
  }

  // Rule 5: Default → DISCOVERY
  // Continue exploring needs and building rapport
  let discoveryInstruction = 'Continue discovery: ask open-ended questions to understand lead needs, preferences, and timeline. Build rapport and gather information.';
  
  // Adjust instruction based on current state
  if (currentEmotion === 'confused') {
    discoveryInstruction = 'Lead seems confused. Simplify explanations, use analogies, break down complex concepts, and check for understanding frequently.';
  } else if (objectionsCount === 1) {
    discoveryInstruction = 'One objection detected. Address it gently while continuing to explore needs. Do not be pushy.';
  } else if (questionsCount > 0 && questionsCount < 3) {
    discoveryInstruction = 'Lead is asking questions. Answer clearly and use their questions to guide the conversation toward understanding their needs better.';
  }

  return {
    nextScriptMode: 'DISCOVERY',
    nextPromptInstruction: discoveryInstruction,
    interruptAllowed: false,
    slowDownSpeech: currentEmotion === 'confused', // Slow down if confused
    confidenceBoost: false,
  };
}
