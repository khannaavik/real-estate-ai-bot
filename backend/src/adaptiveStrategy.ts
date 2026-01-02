// backend/src/adaptiveStrategy.ts
// Adaptive strategy selection based on learning patterns

import { getTopPatterns } from "./outcomeLearning";

/**
 * Context for adaptive strategy selection.
 */
export interface AdaptiveStrategyContext {
  campaignId: string;
  leadStatus: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';
  emotion?: 'calm' | 'excited' | 'anxious' | 'frustrated' | 'confused' | null;
  urgencyLevel?: 'low' | 'medium' | 'high' | null;
  objections?: string[];
}

/**
 * Selected adaptive strategy.
 */
export interface AdaptiveStrategy {
  scriptVariant: 'DISCOVERY_SOFT' | 'DISCOVERY_DIRECT' | 'OBJECTION_CALM' | 'OBJECTION_EMPATHETIC' | 'CLOSING_CONFIDENT';
  voiceTone: 'soft' | 'neutral' | 'assertive' | 'empathetic';
  speechRate: 'slow' | 'normal' | 'fast';
  openingStrategy: 'WARM_GREETING' | 'DIRECT_VALUE' | 'QUESTION_LEAD' | 'EMPATHETIC_ACKNOWLEDGE';
  reason: string[];
}

/**
 * Select adaptive strategy based on learning patterns and context.
 * Deterministic logic only - no AI calls.
 */
export async function selectAdaptiveStrategy(
  context: AdaptiveStrategyContext
): Promise<AdaptiveStrategy> {
  const reasons: string[] = [];
  
  try {
    // Fetch top learning patterns for this campaign
    const patterns = await getTopPatterns(context.campaignId);
    
    if (patterns.length === 0) {
      reasons.push('No learning patterns available - using safe defaults');
      return getDefaultStrategy(context);
    }
    
    // Filter patterns matching context
    const matchingPatterns = patterns.filter(pattern => {
      // Match emotion if provided
      if (context.emotion && pattern.emotion !== context.emotion) {
        return false;
      }
      
      // Note: urgencyLevel is not in the pattern type from getTopPatterns
      // We'll match based on emotion and scriptVariant/voiceTone only
      
      // For NOT_PICK leads, prefer patterns with fewer objections
      if (context.leadStatus === 'NOT_PICK' && context.objections && context.objections.length > 0) {
        // Prefer patterns that handle similar objections
        // This is a simplified match - in production, you'd do more sophisticated matching
      }
      
      return true;
    });
    
    if (matchingPatterns.length === 0) {
      reasons.push('No matching patterns found for current context - using safe defaults');
      return getDefaultStrategy(context);
    }
    
    // Pick highest conversion rate pattern
    const bestPattern = matchingPatterns[0]; // Already sorted by conversionCount descending
    
    if (!bestPattern) {
      reasons.push('No valid pattern found - using safe defaults');
      return getDefaultStrategy(context);
    }
    
    reasons.push(`Selected pattern: ${bestPattern.scriptVariant || 'default'} + ${bestPattern.voiceTone || 'default'}`);
    reasons.push(`Based on ${bestPattern.conversionCount} successful conversions`);
    
    // Map pattern to strategy
    const strategy: AdaptiveStrategy = {
      scriptVariant: (bestPattern.scriptVariant as any) || getDefaultScriptVariant(context),
      voiceTone: (bestPattern.voiceTone as any) || getDefaultVoiceTone(context),
      speechRate: getDefaultSpeechRate(context), // Not in patterns, use default
      openingStrategy: getOpeningStrategy(context, bestPattern),
      reason: reasons,
    };
    
    return strategy;
  } catch (err: any) {
    // Graceful degradation: if learning system fails, use defaults
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[AdaptiveStrategy] Error selecting strategy, using defaults:', err);
    }
    reasons.push('Error fetching patterns - using safe defaults');
    return getDefaultStrategy(context);
  }
}

/**
 * Get default strategy based on context.
 */
function getDefaultStrategy(context: AdaptiveStrategyContext): AdaptiveStrategy {
  const reasons: string[] = ['Using safe default strategy'];
  
  return {
    scriptVariant: getDefaultScriptVariant(context),
    voiceTone: getDefaultVoiceTone(context),
    speechRate: getDefaultSpeechRate(context),
    openingStrategy: getDefaultOpeningStrategy(context),
    reason: reasons,
  };
}

/**
 * Get default script variant based on context.
 */
function getDefaultScriptVariant(context: AdaptiveStrategyContext): 'DISCOVERY_SOFT' | 'DISCOVERY_DIRECT' | 'OBJECTION_CALM' | 'OBJECTION_EMPATHETIC' | 'CLOSING_CONFIDENT' {
  if (context.leadStatus === 'HOT') {
    return 'CLOSING_CONFIDENT';
  }
  
  if (context.objections && context.objections.length > 0) {
    if (context.emotion === 'frustrated' || context.emotion === 'anxious') {
      return 'OBJECTION_CALM';
    }
    return 'OBJECTION_EMPATHETIC';
  }
  
  if (context.emotion === 'excited') {
    return 'DISCOVERY_DIRECT';
  }
  
  return 'DISCOVERY_SOFT';
}

/**
 * Get default voice tone based on context.
 */
function getDefaultVoiceTone(context: AdaptiveStrategyContext): 'soft' | 'neutral' | 'assertive' | 'empathetic' {
  if (context.emotion === 'frustrated' || context.emotion === 'anxious') {
    return 'empathetic';
  }
  
  if (context.leadStatus === 'HOT') {
    return 'assertive';
  }
  
  if (context.urgencyLevel === 'high') {
    return 'assertive';
  }
  
  return 'neutral';
}

/**
 * Get default speech rate based on context.
 */
function getDefaultSpeechRate(context: AdaptiveStrategyContext): 'slow' | 'normal' | 'fast' {
  if (context.emotion === 'frustrated' || context.emotion === 'confused') {
    return 'slow';
  }
  
  if (context.urgencyLevel === 'high' && context.leadStatus === 'HOT') {
    return 'fast';
  }
  
  return 'normal';
}

/**
 * Get opening strategy based on context and pattern.
 */
function getOpeningStrategy(
  context: AdaptiveStrategyContext,
  pattern?: { scriptVariant?: string | null; voiceTone?: string | null; emotion?: string | null }
): 'WARM_GREETING' | 'DIRECT_VALUE' | 'QUESTION_LEAD' | 'EMPATHETIC_ACKNOWLEDGE' {
  if (context.emotion === 'frustrated' || context.emotion === 'anxious') {
    return 'EMPATHETIC_ACKNOWLEDGE';
  }
  
  if (context.leadStatus === 'HOT' || context.urgencyLevel === 'high') {
    return 'DIRECT_VALUE';
  }
  
  if (context.leadStatus === 'WARM') {
    return 'QUESTION_LEAD';
  }
  
  return 'WARM_GREETING';
}

/**
 * Get default opening strategy.
 */
function getDefaultOpeningStrategy(context: AdaptiveStrategyContext): 'WARM_GREETING' | 'DIRECT_VALUE' | 'QUESTION_LEAD' | 'EMPATHETIC_ACKNOWLEDGE' {
  return getOpeningStrategy(context);
}

/**
 * Auto-apply strategy result (STEP 21: Adaptive Strategy Selection).
 * Returns the best-performing strategy based on historical patterns.
 */
export interface AutoApplyStrategyResult {
  scriptVariant: 'DISCOVERY_SOFT' | 'DISCOVERY_DIRECT' | 'OBJECTION_CALM' | 'OBJECTION_EMPATHETIC' | 'CLOSING_CONFIDENT';
  voiceTone: 'soft' | 'neutral' | 'assertive' | 'empathetic';
  emotion: 'calm' | 'excited' | 'anxious' | 'frustrated' | 'confused' | null;
  urgencyLevel: 'low' | 'medium' | 'high' | null;
}

/**
 * Select best strategy from OutcomeLearningPattern for auto-apply (STEP 21).
 * Deterministic logic: highest conversion count, then highest conversion rate.
 * 
 * @param campaignId - Campaign ID to get patterns for
 * @returns AutoApplyStrategyResult or null if no patterns exist
 */
export async function selectBestStrategyForAutoApply(
  campaignId: string
): Promise<AutoApplyStrategyResult | null> {
  try {
    const patterns = await getTopPatterns(campaignId);
    
    if (patterns.length === 0) {
      return null;
    }
    
    // Sort by conversion count (descending), then by conversion rate (descending)
    const sortedPatterns = [...patterns].sort((a, b) => {
      // First sort by conversion count
      if (b.conversionCount !== a.conversionCount) {
        return b.conversionCount - a.conversionCount;
      }
      // Then by conversion rate
      return b.conversionRate - a.conversionRate;
    });
    
    const bestPattern = sortedPatterns[0];
    
    if (!bestPattern) {
      return null;
    }
    
    // Map pattern to AutoApplyStrategyResult
    return {
      scriptVariant: (bestPattern.scriptVariant as any) || 'DISCOVERY_SOFT',
      voiceTone: (bestPattern.voiceTone as any) || 'neutral',
      emotion: (bestPattern.emotion as any) || null,
      urgencyLevel: (bestPattern.urgencyLevel as 'low' | 'medium' | 'high' | null) || null,
    };
  } catch (err: any) {
    // Graceful degradation: if table doesn't exist, return null
    if (err?.code === 'P2003' || err?.message?.includes('does not exist') || err?.message?.includes('Unknown model')) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[AdaptiveStrategy] OutcomeLearningPattern table may not exist yet.');
      }
      return null;
    }
    console.error('[AdaptiveStrategy] Error selecting best strategy:', err);
    return null;
  }
}
