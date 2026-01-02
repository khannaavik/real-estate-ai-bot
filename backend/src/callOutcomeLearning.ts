// backend/src/callOutcomeLearning.ts
// Deterministic pattern learning from call outcomes

/**
 * Learned pattern from successful calls.
 */
export type LearnedPattern = {
  id: string;
  outcomeBucket: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  emotion: string;
  urgencyLevel: string;
  objections: string[];
  scriptMode: string;
  voiceTone: string;
  speechRate: string;
  success: boolean;
};

/**
 * In-memory storage for learned patterns.
 * Key format: `${emotion}_${urgencyLevel}`
 * Value: Array of patterns (max 50 per key, FIFO eviction)
 */
const patternStore = new Map<string, LearnedPattern[]>();

/**
 * Maximum number of patterns to store per key (emotion + urgencyLevel combination).
 */
const MAX_PATTERNS_PER_KEY = 50;

/**
 * Record an outcome pattern for learning.
 * Only stores patterns where outcomeBucket is HIGH or VERY_HIGH (successful outcomes).
 * 
 * Storage Strategy:
 * - Key: `${emotion}_${urgencyLevel}` (e.g., "excited_high", "calm_medium")
 * - Value: Array of patterns, max 50 per key
 * - FIFO eviction: when limit reached, remove oldest pattern
 * 
 * @param input - LearnedPattern with call outcome data
 */
export function recordOutcomePattern(input: LearnedPattern): void {
  // Only record successful outcomes (HIGH or VERY_HIGH)
  if (input.outcomeBucket !== 'HIGH' && input.outcomeBucket !== 'VERY_HIGH') {
    return;
  }

  // Create key from emotion and urgencyLevel
  const key = `${input.emotion}_${input.urgencyLevel}`;
  
  // Get existing patterns for this key, or initialize empty array
  const patterns = patternStore.get(key) || [];
  
  // Add new pattern
  patterns.push(input);
  
  // Enforce max limit: remove oldest patterns if over limit (FIFO)
  if (patterns.length > MAX_PATTERNS_PER_KEY) {
    const excess = patterns.length - MAX_PATTERNS_PER_KEY;
    patterns.splice(0, excess); // Remove oldest patterns
  }
  
  // Store back in map
  patternStore.set(key, patterns);
  
  // Log in dev mode only
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[CallOutcomeLearning] Recorded pattern for ${key}. Total patterns: ${patterns.length}`);
  }
}

/**
 * Suggest optimized strategy based on historical successful patterns.
 * 
 * Strategy Selection:
 * - Look up patterns by emotion + urgencyLevel key
 * - Find patterns that match the current objections (if any)
 * - Calculate most common successful scriptMode, voiceTone, speechRate
 * - Return recommendations if confidence is high enough
 * 
 * Confidence Rules:
 * - Need at least 3 matching patterns to make a recommendation
 * - Use mode (most common value) for each field
 * - Only recommend if mode appears in >50% of patterns
 * 
 * @param context - Current call context with emotion, urgencyLevel, and objections
 * @returns Recommended strategy fields, or undefined if no strong pattern found
 */
export function suggestOptimizedStrategy(context: {
  emotion: string;
  urgencyLevel: string;
  objections: string[];
}): {
  recommendedScriptMode?: string;
  recommendedVoiceTone?: string;
  recommendedSpeechRate?: string;
} {
  const { emotion, urgencyLevel, objections } = context;
  
  // Create lookup key
  const key = `${emotion}_${urgencyLevel}`;
  
  // Get patterns for this key
  const patterns = patternStore.get(key);
  
  if (!patterns || patterns.length === 0) {
    // No patterns found for this combination
    return {};
  }
  
  // Filter patterns by objections if objections exist
  // Match if pattern has at least one matching objection, or if no objections in pattern
  let matchingPatterns = patterns;
  if (objections && objections.length > 0) {
    matchingPatterns = patterns.filter(pattern => {
      // If pattern has no objections, it matches
      if (!pattern.objections || pattern.objections.length === 0) {
        return true;
      }
      // Check if any objection matches
      return pattern.objections.some(obj => 
        objections.some(currentObj => 
          obj.toLowerCase() === currentObj.toLowerCase()
        )
      );
    });
  }
  
  // Need at least 3 matching patterns to make a recommendation
  if (matchingPatterns.length < 3) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[CallOutcomeLearning] Insufficient patterns (${matchingPatterns.length}) for ${key}`);
    }
    return {};
  }
  
  // Calculate mode (most common value) for each field
  const scriptModeCounts = new Map<string, number>();
  const voiceToneCounts = new Map<string, number>();
  const speechRateCounts = new Map<string, number>();
  
  matchingPatterns.forEach(pattern => {
    // Count scriptMode
    const scriptMode = pattern.scriptMode || '';
    scriptModeCounts.set(scriptMode, (scriptModeCounts.get(scriptMode) || 0) + 1);
    
    // Count voiceTone
    const voiceTone = pattern.voiceTone || '';
    voiceToneCounts.set(voiceTone, (voiceToneCounts.get(voiceTone) || 0) + 1);
    
    // Count speechRate
    const speechRate = pattern.speechRate || '';
    speechRateCounts.set(speechRate, (speechRateCounts.get(speechRate) || 0) + 1);
  });
  
  // Find mode for each field
  const findMode = (counts: Map<string, number>, total: number): string | undefined => {
    let maxCount = 0;
    let mode: string | undefined;
    
    counts.forEach((count, value) => {
      if (count > maxCount) {
        maxCount = count;
        mode = value;
      }
    });
    
    // Only recommend if mode appears in >50% of patterns
    if (mode && maxCount > total * 0.5) {
      return mode;
    }
    
    return undefined;
  };
  
  const recommendedScriptMode = findMode(scriptModeCounts, matchingPatterns.length);
  const recommendedVoiceTone = findMode(voiceToneCounts, matchingPatterns.length);
  const recommendedSpeechRate = findMode(speechRateCounts, matchingPatterns.length);
  
  const result: {
    recommendedScriptMode?: string;
    recommendedVoiceTone?: string;
    recommendedSpeechRate?: string;
  } = {};
  
  if (recommendedScriptMode) {
    result.recommendedScriptMode = recommendedScriptMode;
  }
  if (recommendedVoiceTone) {
    result.recommendedVoiceTone = recommendedVoiceTone;
  }
  if (recommendedSpeechRate) {
    result.recommendedSpeechRate = recommendedSpeechRate;
  }
  
  // Log in dev mode only
  if (process.env.NODE_ENV !== 'production' && Object.keys(result).length > 0) {
    console.log(`[CallOutcomeLearning] Suggested strategy for ${key}:`, result);
  }
  
  return result;
}

/**
 * Get statistics about learned patterns (for debugging/monitoring).
 * 
 * @returns Object with pattern counts per key
 */
export function getPatternStats(): Record<string, number> {
  const stats: Record<string, number> = {};
  patternStore.forEach((patterns, key) => {
    stats[key] = patterns.length;
  });
  return stats;
}
