// backend/src/voiceScriptController.ts
// Provider-agnostic voice modulation and multilingual script control

/**
 * Input for voice and script decision.
 */
export interface VoiceScriptDecisionInput {
  emotion: 'calm' | 'excited' | 'frustrated' | 'hesitant';
  urgencyLevel: 'low' | 'medium' | 'high';
  scriptMode: 'DISCOVERY' | 'OBJECTION' | 'CLOSING';
  preferredLanguage?: 'en' | 'hi' | 'hinglish';
}

/**
 * Output from voice and script decision.
 */
export interface VoiceScriptDecisionOutput {
  voiceTone: 'soft' | 'neutral' | 'assertive' | 'empathetic';
  speechRate: 'slow' | 'normal' | 'fast';
  language: 'en' | 'hi' | 'hinglish';
  scriptVariant:
    | 'DISCOVERY_SOFT'
    | 'DISCOVERY_DIRECT'
    | 'OBJECTION_CALM'
    | 'OBJECTION_EMPATHETIC'
    | 'CLOSING_CONFIDENT';
}

/**
 * Decide voice tone, speech rate, language, and script variant based on emotion, urgency, and script mode.
 * 
 * This is a provider-agnostic decision layer that determines:
 * - Voice tone: How the AI should sound (soft, neutral, assertive, empathetic)
 * - Speech rate: How fast to speak (slow, normal, fast)
 * - Language: Which language to use (en, hi, hinglish)
 * - Script variant: Which script variation to use for the given mode
 * 
 * Voice Tone Rules:
 * - frustrated → empathetic (show understanding and care)
 * - excited + high urgency → assertive (confident and direct)
 * - hesitant → soft (gentle and non-threatening)
 * - default → neutral (balanced and professional)
 * 
 * Speech Rate Rules:
 * - frustrated → slow (give time to process, show patience)
 * - excited + high urgency → fast (match energy, create momentum)
 * - hesitant → slow (gentle pace, reduce pressure)
 * - default → normal (standard conversational pace)
 * 
 * Script Variant Rules:
 * - DISCOVERY + calm/hesitant → DISCOVERY_SOFT (gentle exploration)
 * - DISCOVERY + excited → DISCOVERY_DIRECT (straightforward questions)
 * - OBJECTION + frustrated → OBJECTION_EMPATHETIC (understanding and supportive)
 * - OBJECTION + other → OBJECTION_CALM (calm addressing of concerns)
 * - CLOSING → CLOSING_CONFIDENT (confident closing approach)
 * 
 * Language Rules:
 * - Use preferredLanguage if provided
 * - Fallback to 'en' (English) if not provided
 * 
 * @param input - VoiceScriptDecisionInput with emotion, urgency, script mode, and preferred language
 * @returns VoiceScriptDecisionOutput with voice parameters and script variant
 */
export function decideVoiceAndScript(input: VoiceScriptDecisionInput): VoiceScriptDecisionOutput {
  const { emotion, urgencyLevel, scriptMode, preferredLanguage } = input;
  
  // Determine voice tone
  let voiceTone: 'soft' | 'neutral' | 'assertive' | 'empathetic';
  if (emotion === 'frustrated') {
    voiceTone = 'empathetic';
  } else if (emotion === 'excited' && urgencyLevel === 'high') {
    voiceTone = 'assertive';
  } else if (emotion === 'hesitant') {
    voiceTone = 'soft';
  } else {
    voiceTone = 'neutral';
  }
  
  // Determine speech rate
  let speechRate: 'slow' | 'normal' | 'fast';
  if (emotion === 'frustrated') {
    speechRate = 'slow';
  } else if (emotion === 'excited' && urgencyLevel === 'high') {
    speechRate = 'fast';
  } else if (emotion === 'hesitant') {
    speechRate = 'slow';
  } else {
    speechRate = 'normal';
  }
  
  // Determine script variant
  let scriptVariant:
    | 'DISCOVERY_SOFT'
    | 'DISCOVERY_DIRECT'
    | 'OBJECTION_CALM'
    | 'OBJECTION_EMPATHETIC'
    | 'CLOSING_CONFIDENT';
  
  if (scriptMode === 'DISCOVERY') {
    if (emotion === 'calm' || emotion === 'hesitant') {
      scriptVariant = 'DISCOVERY_SOFT';
    } else if (emotion === 'excited') {
      scriptVariant = 'DISCOVERY_DIRECT';
    } else {
      // Default for DISCOVERY mode
      scriptVariant = 'DISCOVERY_SOFT';
    }
  } else if (scriptMode === 'OBJECTION') {
    if (emotion === 'frustrated') {
      scriptVariant = 'OBJECTION_EMPATHETIC';
    } else {
      scriptVariant = 'OBJECTION_CALM';
    }
  } else if (scriptMode === 'CLOSING') {
    scriptVariant = 'CLOSING_CONFIDENT';
  } else {
    // Fallback (should not happen with current script modes)
    scriptVariant = 'DISCOVERY_SOFT';
  }
  
  // Determine language
  const language: 'en' | 'hi' | 'hinglish' = preferredLanguage || 'en';
  
  return {
    voiceTone,
    speechRate,
    language,
    scriptVariant,
  };
}

