// types/campaign.ts
// Shared CampaignContact type definition

export type Contact = {
  id: string;
  name: string;
  phone: string;
  email?: string;
};

export type CampaignContact = {
  id: string;
  campaignId: string;
  contactId: string;
  status: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';
  lastCallAt?: string | null;
  contact?: Contact;
  postCallSummary?: string; // For getLastCallSummary helper
  outcome?: {
    score?: number;
    bucket?: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
    action?: 'DROP' | 'NURTURE' | 'FOLLOW_UP' | 'HUMAN_HANDOFF';
    followUp?: 'CALL_2H' | 'CALL_24H' | 'CALL_48H' | 'WHATSAPP' | 'EMAIL' | 'NONE';
    confidence?: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  context?: {
    emotion: 'calm' | 'excited' | 'frustrated' | 'hesitant';
    urgencyLevel: 'low' | 'medium' | 'high';
    scriptMode: 'INTRO' | 'DISCOVERY' | 'QUALIFICATION' | 'CLOSING' | 'FOLLOW_UP' | 'OBJECTION' | 'PITCH' | 'OBJECTION_HANDLING';
  };
  voiceStrategy?: {
    voiceTone: 'soft' | 'neutral' | 'assertive' | 'empathetic';
    speechRate: 'slow' | 'normal' | 'fast';
    scriptVariant: 'DISCOVERY_SOFT' | 'DISCOVERY_DIRECT' | 'OBJECTION_CALM' | 'OBJECTION_EMPATHETIC' | 'CLOSING_CONFIDENT';
    language: 'en' | 'hi' | 'hinglish';
  };
  adaptiveStep?: {
    scriptMode: 'DISCOVERY' | 'PITCH' | 'OBJECTION_HANDLING' | 'CLOSING' | 'INTRO' | 'QUALIFICATION' | 'FOLLOW_UP' | 'OBJECTION';
    nextPromptInstruction: string;
    slowDownSpeech: boolean;
    interruptAllowed: boolean;
    confidenceBoost: boolean;
  };
  learningStrategy?: {
    recommendedScriptMode?: string;
    recommendedVoiceTone?: string;
    recommendedSpeechRate?: string;
    basedOn: string;
  };
  humanOverride?: {
    scriptMode?: string;
    scriptVariant?: string;
    voiceTone?: string;
    speechRate?: string;
    followUpChannel?: string;
    followUpAfterHours?: number;
    followUpMessageIntent?: string;
    status?: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';
    forceHandoff?: boolean;
    stopBatch?: boolean;
    stopCurrentCall?: boolean;
    overrideStrategy?: boolean; // STEP 21: Disable auto-strategy flag
    overrideReason?: string;
    overriddenBy?: string;
    overriddenAt?: string;
  };
  autoAppliedStrategy?: { // STEP 21: Auto-applied strategy data
    scriptVariant?: string;
    voiceTone?: string;
    emotion?: string;
    urgencyLevel?: string;
    source?: 'AUTO';
    reason?: string;
  };
  liveCall?: { // STEP 23: Live call monitoring data
    callLogId?: string;
    transcriptSummary?: string;
    emotion?: 'calm' | 'excited' | 'frustrated' | 'hesitant';
    urgencyLevel?: 'low' | 'medium' | 'high';
    objections?: string[];
    riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
    suggestions?: string[];
    lastUpdateAt?: string;
  };
  // STEP 24: Call history with self-review - ALL fields optional to support partial API payloads
  calls?: Array<{
    id: string;
    startedAt?: string;
    endedAt?: string | null;
    durationSeconds?: number | null;
    transcript?: string | null;
    outcomeBucket?: string;
    outcomeProbability?: number;
    resultStatus?: 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';
    aiSelfReview?: {
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
  }>;
};

