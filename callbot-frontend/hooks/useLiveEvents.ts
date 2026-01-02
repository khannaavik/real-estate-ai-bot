// hooks/useLiveEvents.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { LeadTimelineEvent } from '../types/lead';

export type EventType = 'CALL_STARTED' | 'CALL_ENDED' | 'LEAD_UPDATED' | 'CALL_OUTCOME_PREDICTED' | 'CALL_CONTEXT_UPDATED' | 'VOICE_STRATEGY_UPDATED' | 'ADAPTIVE_STEP_UPDATED' | 'LEARNING_STRATEGY_APPLIED' | 'HUMAN_OVERRIDE_APPLIED' | 'BATCH_STARTED' | 'BATCH_PROGRESS' | 'BATCH_PAUSED' | 'BATCH_RESUMED' | 'BATCH_COMPLETED' | 'BATCH_CANCELLED' | 'BATCH_SKIPPED_OUTSIDE_TIME_WINDOW' | 'OUTCOME_LEARNING_UPDATED' | 'STRATEGY_SELECTED' | 'STRATEGY_AUTO_APPLIED' | 'CALL_LIVE_UPDATE' | 'CALL_LIVE_RISK' | 'CALL_LIVE_SUGGESTION' | 'CALL_SELF_REVIEW_READY' | 'LEAD_CREATED' | 'CAMPAIGN_CREATED' | 'connected';

export interface SSEEvent {
  type: EventType;
  campaignId: string;
  contactId: string;
  campaignContactId?: string;
  data: {
    status?: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';
    lastCallAt?: string;
    callSid?: string;
    callLogId?: string;
    durationSeconds?: number;
    resultStatus?: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';
    // Call outcome prediction data (for CALL_OUTCOME_PREDICTED event)
    probabilityScore?: number;
    bucket?: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    action?: 'DROP' | 'NURTURE' | 'FOLLOW_UP' | 'HUMAN_HANDOFF';
    followUp?: 'CALL_2H' | 'CALL_24H' | 'CALL_48H' | 'WHATSAPP' | 'EMAIL' | 'NONE';
    confidence?: 'LOW' | 'MEDIUM' | 'HIGH';
    // Call context data (for CALL_CONTEXT_UPDATED event)
    emotion?: 'calm' | 'excited' | 'frustrated' | 'hesitant' | 'anxious'; // 'anxious' is mapped from 'hesitant' in backend
    urgencyLevel?: 'low' | 'medium' | 'high';
    scriptMode?: 'INTRO' | 'DISCOVERY' | 'QUALIFICATION' | 'CLOSING' | 'FOLLOW_UP' | 'DISCOVERY' | 'OBJECTION' | 'PITCH' | 'OBJECTION_HANDLING'; // STEP 20: Updated to include new ScriptMode enum values
    openingLine?: string; // STEP 20: Generated opening line
    probingQuestions?: string[]; // STEP 20: Probing questions for the script mode
    // Voice strategy data (for VOICE_STRATEGY_UPDATED event)
    voiceTone?: 'soft' | 'neutral' | 'assertive' | 'empathetic';
    speechRate?: 'slow' | 'normal' | 'fast';
    scriptVariant?: 'DISCOVERY_SOFT' | 'DISCOVERY_DIRECT' | 'OBJECTION_CALM' | 'OBJECTION_EMPATHETIC' | 'CLOSING_CONFIDENT';
    language?: 'en' | 'hi' | 'hinglish';
    // Adaptive step data (for ADAPTIVE_STEP_UPDATED event)
    nextPromptInstruction?: string;
    slowDownSpeech?: boolean;
    interruptAllowed?: boolean;
    confidenceBoost?: boolean;
    // Learning strategy data (for LEARNING_STRATEGY_APPLIED event)
    recommendedScriptMode?: string;
    recommendedVoiceTone?: string;
    recommendedSpeechRate?: string;
    basedOn?: string;
    // Human override data (for HUMAN_OVERRIDE_APPLIED event)
    overrides?: Record<string, unknown>;
    overriddenBy?: string;
    // Batch orchestrator data (for BATCH_* events)
    batchJobId?: string;
    currentIndex?: number;
    totalLeads?: number;
    success?: boolean;
    skipped?: boolean;
    reason?: string;
    nextRetryTime?: string;
    retryCount?: number;
    // Outcome learning data (for OUTCOME_LEARNING_UPDATED event)
    patternRecorded?: boolean;
    // Adaptive strategy selection data (for STRATEGY_SELECTED event)
    openingStrategy?: 'WARM_GREETING' | 'DIRECT_VALUE' | 'QUESTION_LEAD' | 'EMPATHETIC_ACKNOWLEDGE';
    // Lead creation data (for LEAD_CREATED event)
    name?: string;
    phone?: string;
    source?: string;
    // Campaign creation data (for CAMPAIGN_CREATED event)
    propertyId?: string | null;
    // STEP 21: Auto-applied strategy data (for STRATEGY_AUTO_APPLIED event)
    source?: 'AUTO' | 'MANUAL';
    reason?: string;
    // STEP 23: Live call monitoring data
    callLogId?: string;
    transcriptSummary?: string;
    objections?: string[];
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    suggestions?: string[];
    lastUpdateAt?: string;
    recommendedAction?: 'MONITOR_CLOSELY' | 'HUMAN_HANDOFF';
    emergencyStop?: boolean;
    forceHandoff?: boolean;
    handoffReason?: string;
    // STEP 24: Self-review data
    selfReview?: {
      strengths: string[];
      improvements: string[];
      nextTimeActions: string[];
      predictionAccuracy: {
        status: 'ACCURATE' | 'OVERESTIMATED' | 'UNDERESTIMATED';
        explanation: string;
        predictedBucket?: string;
        actualBucket?: string;
      };
      overallAssessment: string;
      keyLearnings: string[];
    };
  };
  message?: string;
}

interface UseLiveEventsOptions {
  apiBase?: string;
  onEvent?: (event: SSEEvent) => void;
  onTimelineEvent?: (event: LeadTimelineEvent) => void;
  campaignContactId?: string | null;
  mockMode?: boolean;
}

// Helper function to map SSE events to LeadTimelineEvent
function mapSSEToTimelineEvent(sseEvent: SSEEvent): LeadTimelineEvent | null {
  // Only map relevant event types
  if (sseEvent.type === 'CALL_STARTED' || sseEvent.type === 'CALL_ENDED' || sseEvent.type === 'LEAD_UPDATED') {
    // Map event type
    let timelineType: LeadTimelineEvent['type'];
    if (sseEvent.type === 'LEAD_UPDATED') {
      timelineType = 'LEAD_UPDATED';
    } else if (sseEvent.type === 'CALL_STARTED') {
      timelineType = 'CALL_STARTED';
    } else {
      timelineType = 'CALL_ENDED';
    }

    // Generate ID from callLogId or create one
    const id = sseEvent.data.callLogId || 
               sseEvent.data.callSid || 
               `${sseEvent.type}-${sseEvent.campaignContactId}-${Date.now()}`;

    // Use lastCallAt as timestamp if available, otherwise use current time
    const timestamp = sseEvent.data.lastCallAt || new Date().toISOString();

    // Determine status - prefer resultStatus, then status
    const status = sseEvent.data.resultStatus || sseEvent.data.status;

    return {
      id,
      type: timelineType,
      timestamp,
      status,
      callSid: sseEvent.data.callSid,
      callLogId: sseEvent.data.callLogId, // STEP 24: Include callLogId
      durationSeconds: sseEvent.data.durationSeconds,
    };
  }
  return null;
}

export function useLiveEvents(options: UseLiveEventsOptions = {}) {
  const { 
    apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000', 
    onEvent,
    onTimelineEvent,
    campaignContactId,
    mockMode = false,
  } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // Start with 1 second

  const connectRef = useRef<() => void>();
  
  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      return;
    }

    try {
      const eventSource = new EventSource(`${apiBase}/events`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setIsReconnecting(false);
        setError(null);
        reconnectAttemptsRef.current = 0;
        console.log('[SSE] Connected');
      };

      eventSource.onmessage = (e) => {
        try {
          const event: SSEEvent = JSON.parse(e.data);
          
          if (event.type === 'connected') {
            setIsConnected(true);
            return;
          }

          // Call the original callback if provided
          if (onEvent) {
            onEvent(event);
          }

          // Map to timeline event and call timeline callback if provided
          // Only emit when: mockMode is false AND campaignContactId matches
          if (onTimelineEvent && !mockMode && campaignContactId && event.campaignContactId === campaignContactId) {
            const timelineEvent = mapSSEToTimelineEvent(event);
            if (timelineEvent) {
              onTimelineEvent(timelineEvent);
            }
          }
        } catch (err) {
          console.error('[SSE] Error parsing event:', err);
        }
      };

      eventSource.onerror = (err) => {
        console.error('[SSE] Connection error:', err);
        setIsConnected(false);
        
        if (eventSource.readyState === EventSource.CLOSED) {
          setError(new Error('Connection closed'));
          
          // Attempt to reconnect with exponential backoff
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            setIsReconnecting(true);
            const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
            reconnectAttemptsRef.current++;
            
            reconnectTimeoutRef.current = setTimeout(() => {
              console.log(`[SSE] Reconnecting (attempt ${reconnectAttemptsRef.current})...`);
              if (connectRef.current) {
                connectRef.current();
              }
            }, delay);
          } else {
            setIsReconnecting(false);
            setError(new Error('Max reconnection attempts reached'));
          }
        }
      };
    } catch (err) {
      console.error('[SSE] Failed to create EventSource:', err);
      setError(err instanceof Error ? err : new Error('Failed to connect'));
      setIsConnected(false);
    }
  }, [apiBase, onEvent, onTimelineEvent, campaignContactId, mockMode]);
  
  connectRef.current = connect;

  useEffect(() => {
    connect();

    return () => {
      // Cleanup on unmount
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [connect]);

  return {
    isConnected,
    error,
    isReconnecting,
    reconnect: connect,
  };
}

