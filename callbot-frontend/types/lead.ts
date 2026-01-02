// types/lead.ts
// Shared types for lead-related data structures

export type LeadStatus = 'NOT_PICK' | 'COLD' | 'WARM' | 'HOT';

/**
 * Script mode enum for conversation strategy (STEP 20: Conversation Strategy Engine).
 * Determines the overall approach and tone of the conversation.
 */
export type ScriptMode = 'INTRO' | 'DISCOVERY' | 'QUALIFICATION' | 'CLOSING' | 'FOLLOW_UP';

export type LeadTimelineEventType = 'CALL_STARTED' | 'CALL_ENDED' | 'LEAD_UPDATED';

export interface LeadTimelineEvent {
  id: string;
  type: LeadTimelineEventType;
  timestamp: string; // ISO format
  status?: LeadStatus;
  callSid?: string;
  callLogId?: string; // STEP 24: Include callLogId for fetching reviews
  durationSeconds?: number;
  scriptMode?: ScriptMode; // STEP 20: Include ScriptMode in timeline events
}

