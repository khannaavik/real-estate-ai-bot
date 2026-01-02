// backend/src/liveCallMonitor.ts
// Live Whisper Monitor - Real-time visibility and control during live AI calls

import { detectEmotionAndUrgency } from "./emotionUrgencyDetection";
import { extractConversationMemory } from "./leadScoring";
import { eventBus, type SSEEvent } from "./eventBus";

/**
 * Live call state for a single call.
 * Tracks partial transcript and analysis state.
 */
interface LiveCallState {
  callLogId: string;
  campaignContactId: string;
  campaignId: string;
  contactId: string;
  transcriptChunks: string[];
  fullTranscript: string;
  lastUpdateAt: Date;
  emotion?: 'calm' | 'excited' | 'frustrated' | 'hesitant' | 'anxious';
  urgencyLevel?: 'low' | 'medium' | 'high';
  detectedObjections: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  suggestions: string[];
}

/**
 * In-memory store for active live calls.
 * Key: callLogId
 */
const liveCalls = new Map<string, LiveCallState>();

/**
 * Process a transcript chunk for a live call.
 * Aggregates chunks, analyzes sentiment, and emits SSE events.
 * 
 * @param callLogId - Call log ID
 * @param transcriptChunk - New transcript chunk
 * @param campaignContactId - Campaign contact ID
 * @param campaignId - Campaign ID
 * @param contactId - Contact ID
 */
export function processLiveTranscriptChunk(
  callLogId: string,
  transcriptChunk: string,
  campaignContactId: string,
  campaignId: string,
  contactId: string
): void {
  try {
    // Get or create live call state
    let callState = liveCalls.get(callLogId);
    
    if (!callState) {
      callState = {
        callLogId,
        campaignContactId,
        campaignId,
        contactId,
        transcriptChunks: [],
        fullTranscript: '',
        lastUpdateAt: new Date(),
        detectedObjections: [],
        riskLevel: 'LOW',
        suggestions: [],
      };
      liveCalls.set(callLogId, callState);
    }

    // Add new chunk
    callState.transcriptChunks.push(transcriptChunk);
    callState.fullTranscript = callState.transcriptChunks.join(' ');
    callState.lastUpdateAt = new Date();

    // Analyze transcript (deterministic only - no AI calls)
    analyzeLiveTranscript(callState);

    // Emit CALL_LIVE_UPDATE SSE event
    emitLiveUpdate(callState);
  } catch (err: any) {
    console.error('[LiveCallMonitor] Error processing transcript chunk:', err);
    // Continue execution - don't crash on analysis errors
  }
}

/**
 * Analyze live transcript for emotion, urgency, objections, and risks.
 * Deterministic analysis only - no AI calls.
 */
function analyzeLiveTranscript(state: LiveCallState): void {
  const transcript = state.fullTranscript;
  const duration = Math.floor((Date.now() - (state.lastUpdateAt.getTime() - 60000)) / 1000); // Estimate duration

  // Detect emotion and urgency
  try {
    const emotionUrgency = detectEmotionAndUrgency(transcript, duration);
    state.emotion = emotionUrgency.emotion;
    state.urgencyLevel = emotionUrgency.urgencyLevel;
  } catch (err) {
    // If detection fails, keep previous values
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[LiveCallMonitor] Emotion/urgency detection failed:', err);
    }
  }

  // Extract conversation memory (includes objections)
  try {
    const conversationMemory = extractConversationMemory(transcript);
    state.detectedObjections = conversationMemory.objections
      .filter(obj => typeof obj === 'string')
      .map(obj => obj.toUpperCase());
  } catch (err) {
    // If extraction fails, keep previous objections
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[LiveCallMonitor] Objection extraction failed:', err);
    }
  }

  // Determine risk level (deterministic rules)
  state.riskLevel = determineRiskLevel(state);

  // Generate suggestions (deterministic rules)
  state.suggestions = generateSuggestions(state);
}

/**
 * Determine risk level based on call state.
 * Deterministic rules only.
 */
function determineRiskLevel(state: LiveCallState): 'LOW' | 'MEDIUM' | 'HIGH' {
  // HIGH risk indicators
  if (state.emotion === 'frustrated' && state.urgencyLevel === 'high') {
    return 'HIGH';
  }
  if (state.detectedObjections.length >= 3) {
    return 'HIGH';
  }
  if (state.detectedObjections.includes('TRUST') || state.detectedObjections.includes('PRICE')) {
    if (state.emotion === 'frustrated') {
      return 'HIGH';
    }
  }

  // MEDIUM risk indicators
  if (state.emotion === 'frustrated' || state.urgencyLevel === 'high') {
    return 'MEDIUM';
  }
  if (state.detectedObjections.length >= 2) {
    return 'MEDIUM';
  }

  // Default: LOW risk
  return 'LOW';
}

/**
 * Generate suggestions based on call state.
 * Deterministic rules only.
 */
function generateSuggestions(state: LiveCallState): string[] {
  const suggestions: string[] = [];

  if (state.emotion === 'frustrated') {
    suggestions.push('Consider switching to empathetic tone');
    suggestions.push('Acknowledge concerns and show understanding');
  }

  if (state.urgencyLevel === 'high') {
    suggestions.push('Lead shows high urgency - focus on closing');
  }

  if (state.detectedObjections.includes('PRICE')) {
    suggestions.push('Address pricing concerns - highlight value proposition');
  }

  if (state.detectedObjections.includes('TRUST')) {
    suggestions.push('Build trust - mention RERA, builder reputation, testimonials');
  }

  if (state.detectedObjections.includes('LOCATION')) {
    suggestions.push('Emphasize location benefits - connectivity, amenities nearby');
  }

  if (state.detectedObjections.length === 0 && state.emotion === 'excited') {
    suggestions.push('Lead is engaged - move toward scheduling site visit');
  }

  if (suggestions.length === 0) {
    suggestions.push('Continue with current strategy');
  }

  return suggestions;
}

/**
 * Emit CALL_LIVE_UPDATE SSE event.
 */
function emitLiveUpdate(state: LiveCallState): void {
  const updateEvent: SSEEvent = {
    type: 'CALL_LIVE_UPDATE',
    campaignId: state.campaignId,
    contactId: state.contactId,
    campaignContactId: state.campaignContactId,
    data: {
      callLogId: state.callLogId,
      transcriptSummary: getTranscriptSummary(state.fullTranscript),
      ...(state.emotion && {
        emotion: state.emotion === 'hesitant' ? 'confused' : (state.emotion as 'calm' | 'excited' | 'anxious' | 'frustrated' | 'confused'),
      }),
      ...(state.urgencyLevel && { urgencyLevel: state.urgencyLevel }),
      objections: state.detectedObjections,
      riskLevel: state.riskLevel,
      suggestions: state.suggestions,
      lastUpdateAt: state.lastUpdateAt.toISOString(),
    },
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log('[SSE] CALL_LIVE_UPDATE payload:', JSON.stringify(updateEvent, null, 2));
  }

  eventBus.emit('event', updateEvent);

  // Emit risk event if risk level is MEDIUM or HIGH
  if (state.riskLevel === 'MEDIUM' || state.riskLevel === 'HIGH') {
    emitRiskEvent(state);
  }
}

/**
 * Emit CALL_LIVE_RISK SSE event for elevated risk situations.
 */
function emitRiskEvent(state: LiveCallState): void {
  const riskEvent: SSEEvent = {
    type: 'CALL_LIVE_RISK',
    campaignId: state.campaignId,
    contactId: state.contactId,
    campaignContactId: state.campaignContactId,
    data: {
      callLogId: state.callLogId,
      riskLevel: state.riskLevel,
      reason: getRiskReason(state),
      ...(state.emotion && {
        emotion: state.emotion === 'hesitant' ? 'confused' : (state.emotion as 'calm' | 'excited' | 'anxious' | 'frustrated' | 'confused'),
      }),
      ...(state.urgencyLevel && { urgencyLevel: state.urgencyLevel }),
      objections: state.detectedObjections,
      recommendedAction: state.riskLevel === 'HIGH' ? 'HUMAN_HANDOFF' : 'MONITOR_CLOSELY',
    },
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log('[SSE] CALL_LIVE_RISK payload:', JSON.stringify(riskEvent, null, 2));
  }

  eventBus.emit('event', riskEvent);
}

/**
 * Emit CALL_LIVE_SUGGESTION SSE event with actionable suggestions.
 */
export function emitSuggestionEvent(
  callLogId: string,
  suggestion: string,
  campaignContactId: string,
  campaignId: string,
  contactId: string
): void {
  const suggestionEvent: SSEEvent = {
    type: 'CALL_LIVE_SUGGESTION',
    campaignId,
    contactId,
    campaignContactId,
    data: {
      callLogId,
      suggestions: [suggestion], // Convert single suggestion to array to match SSEEvent interface
      lastUpdateAt: new Date().toISOString(),
    },
  };

  if (process.env.NODE_ENV !== 'production') {
    console.log('[SSE] CALL_LIVE_SUGGESTION payload:', JSON.stringify(suggestionEvent, null, 2));
  }

  eventBus.emit('event', suggestionEvent);
}

/**
 * Get transcript summary (last 100 words or last 3 sentences).
 */
function getTranscriptSummary(transcript: string): string {
  if (!transcript || transcript.trim().length === 0) {
    return 'No transcript available yet';
  }

  const words = transcript.trim().split(/\s+/);
  if (words.length <= 100) {
    return transcript;
  }

  // Return last 100 words
  return words.slice(-100).join(' ') + '...';
}

/**
 * Get risk reason based on call state.
 */
function getRiskReason(state: LiveCallState): string {
  const reasons: string[] = [];

  if (state.emotion === 'frustrated' && state.urgencyLevel === 'high') {
    reasons.push('High frustration with urgent tone');
  }

  if (state.detectedObjections.length >= 3) {
    reasons.push(`Multiple objections detected (${state.detectedObjections.length})`);
  }

  if (state.detectedObjections.includes('TRUST') && state.emotion === 'frustrated') {
    reasons.push('Trust objection with frustrated emotion');
  }

  if (state.detectedObjections.includes('PRICE') && state.emotion === 'frustrated') {
    reasons.push('Price objection with frustrated emotion');
  }

  return reasons.join('; ') || 'Elevated risk detected';
}

/**
 * Get live call state for a call log ID.
 */
export function getLiveCallState(callLogId: string): LiveCallState | null {
  return liveCalls.get(callLogId) || null;
}

/**
 * Check if a call is currently live.
 */
export function isCallLive(callLogId: string): boolean {
  return liveCalls.has(callLogId);
}

/**
 * End live monitoring for a call.
 * Call this when the call ends.
 */
export function endLiveMonitoring(callLogId: string): void {
  liveCalls.delete(callLogId);
}

/**
 * Get all active live calls.
 */
export function getActiveLiveCalls(): LiveCallState[] {
  return Array.from(liveCalls.values());
}
