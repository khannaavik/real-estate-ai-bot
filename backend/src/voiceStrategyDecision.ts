// backend/src/voiceStrategyDecision.ts
// Voice tone, speech rate, and script variant decision based on emotion and urgency

/**
 * Voice strategy decision result.
 */
export interface VoiceStrategyDecision {
  voiceTone: 'soft' | 'neutral' | 'assertive' | 'empathetic';
  speechRate: 'slow' | 'normal' | 'fast';
  scriptVariant: 'DISCOVERY_SOFT' | 'DISCOVERY_DIRECT' | 'OBJECTION_CALM' | 'OBJECTION_EMPATHETIC' | 'CLOSING_CONFIDENT';
}

/**
 * Decide voice tone, speech rate, and script variant based on emotion and urgency level.
 * 
 * This is a deterministic decision system that maps emotion + urgency to voice parameters:
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
 * - excited + high urgency → CLOSING_CONFIDENT (confident closing approach)
 * - frustrated → OBJECTION_EMPATHETIC (understanding and supportive)
 * - hesitant → DISCOVERY_SOFT (gentle exploration)
 * - excited + medium/low urgency → DISCOVERY_DIRECT (straightforward questions)
 * - calm → DISCOVERY_SOFT (default gentle exploration)
 * 
 * @param emotion - Detected emotion: 'calm' | 'excited' | 'frustrated' | 'hesitant'
 * @param urgencyLevel - Detected urgency level: 'low' | 'medium' | 'high'
 * @returns VoiceStrategyDecision with voice tone, speech rate, and script variant
 */
export function decideVoiceAndScript(
  emotion: 'calm' | 'excited' | 'frustrated' | 'hesitant',
  urgencyLevel: 'low' | 'medium' | 'high'
): VoiceStrategyDecision {
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
  let scriptVariant: 'DISCOVERY_SOFT' | 'DISCOVERY_DIRECT' | 'OBJECTION_CALM' | 'OBJECTION_EMPATHETIC' | 'CLOSING_CONFIDENT';
  
  if (emotion === 'excited' && urgencyLevel === 'high') {
    scriptVariant = 'CLOSING_CONFIDENT';
  } else if (emotion === 'frustrated') {
    scriptVariant = 'OBJECTION_EMPATHETIC';
  } else if (emotion === 'hesitant') {
    scriptVariant = 'DISCOVERY_SOFT';
  } else if (emotion === 'excited' && (urgencyLevel === 'medium' || urgencyLevel === 'low')) {
    scriptVariant = 'DISCOVERY_DIRECT';
  } else {
    // Default for calm emotion
    scriptVariant = 'DISCOVERY_SOFT';
  }
  
  return {
    voiceTone,
    speechRate,
    scriptVariant,
  };
}
