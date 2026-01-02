// utils/labelHelpers.ts
// Helper functions for human-readable labels (STEP 21: User Comfort Mode)

/**
 * Convert outcome bucket to human-readable label
 */
export function getOutcomeBucketLabel(bucket: string | null | undefined): string {
  if (!bucket) return 'Unknown';
  
  switch (bucket) {
    case 'VERY_HIGH':
      return 'High Buying Intent';
    case 'HIGH':
      return 'Likely to Convert';
    case 'MEDIUM':
      return 'Needs Follow-up';
    case 'LOW':
      return 'Low Interest';
    case 'VERY_LOW':
      return 'Not Interested';
    default:
      return bucket;
  }
}

/**
 * Get recommended next action text from outcome data
 */
export function getRecommendedNextAction(outcome: {
  action?: 'DROP' | 'NURTURE' | 'FOLLOW_UP' | 'HUMAN_HANDOFF';
  followUp?: 'CALL_2H' | 'CALL_24H' | 'CALL_48H' | 'WHATSAPP' | 'EMAIL' | 'NONE';
} | null | undefined): string {
  if (!outcome) return 'No action needed';
  
  if (outcome.action === 'HUMAN_HANDOFF') {
    return 'Assign to sales team';
  }
  
  if (outcome.action === 'FOLLOW_UP') {
    if (outcome.followUp === 'CALL_2H') {
      return 'Follow up in 2 hours';
    } else if (outcome.followUp === 'CALL_24H') {
      return 'Follow up tomorrow';
    } else if (outcome.followUp === 'CALL_48H') {
      return 'Follow up in 2 days';
    } else if (outcome.followUp === 'WHATSAPP') {
      return 'Send WhatsApp message';
    } else if (outcome.followUp === 'EMAIL') {
      return 'Send email';
    }
  }
  
  if (outcome.action === 'NURTURE') {
    return 'Continue nurturing';
  }
  
  if (outcome.action === 'DROP') {
    return 'No further action';
  }
  
  return 'Monitor lead';
}

/**
 * Get last call summary (1-2 sentences) from lead data
 */
export function getLastCallSummary(lead: { status?: string; postCallSummary?: string }): string {
  // Try to get from post-call intelligence if available
  if (lead.postCallSummary) {
    return lead.postCallSummary;
  }
  
  // Generate from status and outcome
  if (lead.status === 'HOT') {
    return 'Lead showed strong buying intent in the last call. Ready for immediate follow-up.';
  } else if (lead.status === 'WARM') {
    return 'Lead expressed interest and asked questions. Follow-up recommended within 24-48 hours.';
  } else if (lead.status === 'COLD') {
    return 'Limited engagement in the last call. Continue nurturing with periodic check-ins.';
  } else if (lead.status === 'NOT_PICK') {
    return 'Lead did not answer the last call. Retry scheduled.';
  }
  
  return 'No recent call activity.';
}
