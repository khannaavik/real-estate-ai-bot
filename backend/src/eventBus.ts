// backend/src/eventBus.ts
import { EventEmitter } from 'events';

// Event types
export type EventType = 'CALL_STARTED' | 'CALL_ENDED' | 'LEAD_UPDATED' | 'CALL_OUTCOME_PREDICTED' | 'CALL_CONTEXT_UPDATED' | 'VOICE_STRATEGY_UPDATED' | 'ADAPTIVE_STEP_UPDATED' | 'LEARNING_STRATEGY_APPLIED' | 'HUMAN_OVERRIDE_APPLIED' | 'BATCH_STARTED' | 'BATCH_PROGRESS' | 'BATCH_PAUSED' | 'BATCH_RESUMED' | 'BATCH_COMPLETED' | 'BATCH_CANCELLED' | 'BATCH_SKIPPED_OUTSIDE_TIME_WINDOW' | 'OUTCOME_LEARNING_UPDATED' | 'STRATEGY_SELECTED' | 'STRATEGY_AUTO_APPLIED' | 'CALL_LIVE_UPDATE' | 'CALL_LIVE_RISK' | 'CALL_LIVE_SUGGESTION' | 'CALL_SELF_REVIEW_READY' | 'LEAD_CREATED' | 'CAMPAIGN_CREATED';

export interface SSEEvent {
  type: EventType;
  campaignId: string;
  contactId: string;
  campaignContactId?: string;
  data: {
    status?: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';
    lastCallAt?: string;
    durationSeconds?: number;
    resultStatus?: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';
    // Call tracking (for CALL_STARTED, CALL_ENDED events)
    callSid?: string;
    callLogId?: string;
    emotion?: 'calm' | 'excited' | 'anxious' | 'frustrated' | 'confused';
    urgencyLevel?: 'low' | 'medium' | 'high';
    scriptMode?: 'INTRO' | 'DISCOVERY' | 'QUALIFICATION' | 'CLOSING' | 'FOLLOW_UP' | 'REASSURANCE' | 'FAST_TRACK' | 'COOL_DOWN' | 'PITCH' | 'OBJECTION_HANDLING'; // STEP 20: Updated to include new ScriptMode enum values
    openingLine?: string; // STEP 20: Generated opening line
    probingQuestions?: string[]; // STEP 20: Probing questions for the script mode
    objectionStrategy?: 'VALUE_REFRAME' | 'SOCIAL_PROOF' | 'CONTEXTUAL_COMPARE' | 'SOFT_URGENCY' | 'ASSISTIVE' | 'SIMPLIFY';
    // Call outcome prediction data (for CALL_OUTCOME_PREDICTED event)
    probabilityScore?: number;
    bucket?: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    action?: 'DROP' | 'NURTURE' | 'FOLLOW_UP' | 'HUMAN_HANDOFF';
    followUp?: 'CALL_2H' | 'CALL_24H' | 'CALL_48H' | 'WHATSAPP' | 'EMAIL' | 'NONE';
    confidence?: 'LOW' | 'MEDIUM' | 'HIGH';
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
    overrides?: any;
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
    source?: string | 'AUTO' | 'MANUAL'; // Used for both lead creation and auto-applied strategy
    // Campaign creation data (for CAMPAIGN_CREATED event)
    propertyId?: string | null;
    // STEP 21: Auto-applied strategy data (for STRATEGY_AUTO_APPLIED event)
    // Note: source and reason are defined above (consolidated)
    // STEP 23: Live call monitoring data
    // Note: callLogId is already defined above (line 19)
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
}

// Create singleton event bus
class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // Allow many SSE connections
  }
}

export const eventBus = new EventBus();

