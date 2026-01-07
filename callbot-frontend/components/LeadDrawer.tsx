// components/LeadDrawer.tsx
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { LeadStatusBadge } from './LeadStatusBadge';
import { LeadTimelineEvent, type LeadStatus } from '../types/lead';
import { getOutcomeBucketLabel, getRecommendedNextAction, getLastCallSummary } from '../utils/labelHelpers';
import { authenticatedFetch, getApiBaseUrl } from '../utils/api';
import type { CampaignContact } from '@/types/campaign';

interface LeadDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  lead: CampaignContact | null;
  campaignName?: string;
  mockMode?: boolean;
  onApplyScore?: () => void;
  onStartCall?: () => void;
  previousFocusElement?: HTMLElement | null;
  liveTimelineEvent?: LeadTimelineEvent | null;
  onLeadStatusUpdate?: (status: LeadStatus) => void;
  isLiveConnected?: boolean;
  isReconnecting?: boolean;
  sseError?: Error | null;
}

export function LeadDrawer({ 
  isOpen, 
  onClose, 
  lead, 
  campaignName,
  mockMode = false,
  onApplyScore,
  onStartCall,
  previousFocusElement,
  liveTimelineEvent,
  onLeadStatusUpdate,
  isLiveConnected = false,
  isReconnecting = false,
  sseError = null,
}: LeadDrawerProps) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const API_BASE = getApiBaseUrl();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  
  // Helper function for authenticated requests
  // Ensures Clerk is loaded and user is signed in before making requests
  const makeAuthenticatedRequest = async (url: string, options?: RequestInit) => {
    // Check Clerk state
    if (!isLoaded) {
      throw new Error('Clerk not loaded');
    }

    if (!isSignedIn) {
      throw new Error('Authentication required: Please sign in');
    }

    const token = await getToken();
    if (!token) {
      throw new Error('Authentication required: No token available');
    }

    return await authenticatedFetch(url, options, token);
  };
  const [timelineEvents, setTimelineEvents] = useState<LeadTimelineEvent[]>([]);
  const [displayLead, setDisplayLead] = useState<CampaignContact | null>(lead);
  const [newestEventId, setNewestEventId] = useState<string | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  // Check for prefers-reduced-motion
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setPrefersReducedMotion(mediaQuery.matches);
      
      const handleChange = (e: MediaQueryListEvent) => {
        setPrefersReducedMotion(e.matches);
      };
      
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, []);
  const [overrideForm, setOverrideForm] = useState({
    scriptMode: '',
    scriptVariant: '',
    voiceTone: '',
    speechRate: '',
    followUpChannel: '',
    followUpAfterHours: '',
    followUpMessageIntent: '',
    status: '',
    forceHandoff: false,
    stopBatch: false,
    stopCurrentCall: false,
    overrideStrategy: false, // STEP 21: Auto-strategy override flag
    overrideReason: '',
    overriddenBy: '',
  });
  const [isSavingOverride, setIsSavingOverride] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState<{
    action: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  // STEP 22: Preview modal state
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  // STEP 23: Live call state
  const [liveCallData, setLiveCallData] = useState<any>(null);
  // STEP 24: Call detail state
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [callReview, setCallReview] = useState<any>(null);
  const [humanFeedback, setHumanFeedback] = useState<string>('');
  // STEP 21: Advanced Details collapsed state
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);

  // Generate mock timeline events
  const generateMockTimeline = (lead: CampaignContact): LeadTimelineEvent[] => {
    const events: LeadTimelineEvent[] = [];
    const now = Date.now();
    const statuses: LeadStatus[] = ['NOT_PICK', 'COLD', 'WARM', 'HOT'];
    
    // Generate 3-5 random events
    const eventCount = 3 + Math.floor(Math.random() * 3); // 3-5 events
    
    for (let i = 0; i < eventCount; i++) {
      const hoursAgo = (eventCount - i) * 2 + Math.random() * 4; // Spread over time
      const timestamp = new Date(now - hoursAgo * 3600000).toISOString();
      const mockCallSid = `CA${Math.random().toString(36).substring(2, 15)}`;
      const mockDuration = Math.floor(Math.random() * 300) + 30; // 30-330 seconds
      
      if (i === 0) {
        // Most recent: Call Ended
        events.push({
          id: `mock-event-${i}`,
          type: 'CALL_ENDED',
          timestamp,
          status: lead.status,
          callSid: mockCallSid,
          durationSeconds: mockDuration,
        });
      } else if (i === 1) {
        // Second: Call Started
        events.push({
          id: `mock-event-${i}`,
          type: 'CALL_STARTED',
          timestamp,
          callSid: mockCallSid,
        });
      } else {
        // Older events: Lead Updated or Call Ended
        const eventType = Math.random() > 0.5 ? 'LEAD_UPDATED' : 'CALL_ENDED';
        events.push({
          id: `mock-event-${i}`,
          type: eventType,
          timestamp,
          status: eventType === 'LEAD_UPDATED' ? statuses[Math.floor(Math.random() * statuses.length)] : lead.status,
          callSid: eventType === 'CALL_ENDED' ? mockCallSid : undefined,
          durationSeconds: eventType === 'CALL_ENDED' ? mockDuration : undefined,
        });
      }
    }
    
    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  // Track previous lead ID to detect changes
  const prevLeadIdRef = useRef<string | null>(null);

  // Seed timeline with mock events on mount if mockMode is ON
  // Also clear timeline when lead changes or drawer closes
  useEffect(() => {
    try {
      if (!isOpen) {
        // Clear timeline when drawer closes
        setTimelineEvents([]);
        prevLeadIdRef.current = null;
        return;
      }

      // Only clear timeline when lead actually changes (not on every render)
      const currentLeadId = lead?.id || null;
      if (currentLeadId !== prevLeadIdRef.current) {
        // Lead changed - clear timeline and regenerate
        setTimelineEvents([]);
        prevLeadIdRef.current = currentLeadId;
        
        if (mockMode && lead) {
          // Generate mock events for the new lead
          const mockEvents = generateMockTimeline(lead);
          setTimelineEvents(mockEvents);
        }
      } else if (mockMode && lead && timelineEvents.length === 0) {
        // Initial load in mock mode - generate events
        const mockEvents = generateMockTimeline(lead);
        setTimelineEvents(mockEvents);
      }
      // In live mode, timeline will be populated by liveTimelineEvent prop
      // Timeline persists even if connection is lost - we don't clear it
    } catch (err) {
      console.error('[LeadDrawer] Error seeding timeline:', err);
      // Continue execution - don't crash
    }
  }, [mockMode, lead?.id, isOpen]); // Use lead?.id to detect lead changes

  // STEP 23: Update live call data when lead changes
  useEffect(() => {
    if (lead?.liveCall) {
      setLiveCallData(lead.liveCall);
    } else {
      setLiveCallData(null);
    }
  }, [lead]);

  // Update displayLead when lead prop changes
  useEffect(() => {
    setDisplayLead(lead);
    // Initialize override form with existing override values
    if (lead?.humanOverride) {
      setOverrideForm({
        scriptMode: lead.humanOverride.scriptMode || '',
        scriptVariant: lead.humanOverride.scriptVariant || '',
        voiceTone: lead.humanOverride.voiceTone || '',
        speechRate: lead.humanOverride.speechRate || '',
        followUpChannel: lead.humanOverride.followUpChannel || '',
        followUpAfterHours: lead.humanOverride.followUpAfterHours?.toString() || '',
        followUpMessageIntent: lead.humanOverride.followUpMessageIntent || '',
        status: lead.humanOverride.status || '',
        forceHandoff: lead.humanOverride.forceHandoff || false,
        stopBatch: lead.humanOverride.stopBatch || false,
        stopCurrentCall: lead.humanOverride.stopCurrentCall || false,
        overrideStrategy: lead.humanOverride.overrideStrategy || false, // STEP 21
        overrideReason: lead.humanOverride.overrideReason || '',
        overriddenBy: lead.humanOverride.overriddenBy || '',
      });
    } else {
      // Reset form if no override
      setOverrideForm({
        scriptMode: '',
        scriptVariant: '',
        voiceTone: '',
        speechRate: '',
        followUpChannel: '',
        followUpAfterHours: '',
        followUpMessageIntent: '',
        status: '',
        forceHandoff: false,
        stopBatch: false,
        stopCurrentCall: false,
        overrideStrategy: false, // STEP 21
        overrideReason: '',
        overriddenBy: '',
      });
    }
  }, [lead]);

  // Handle incoming live timeline events
  useEffect(() => {
    if (!liveTimelineEvent || mockMode) return;

    try {
      setTimelineEvents((prev) => {
        // Dedupe by event.id - check if event already exists
        const existingIndex = prev.findIndex((e) => e.id === liveTimelineEvent.id);
        
        if (existingIndex !== -1) {
          // Event already exists, don't add duplicate
          return prev;
        }

        // Mark as newest event for animation and pulse dot
        setNewestEventId(liveTimelineEvent.id);
        
        // Clear newest marker after animation completes (2 seconds)
        setTimeout(() => {
          setNewestEventId((current) => current === liveTimelineEvent.id ? null : current);
        }, 2000);

        // Prepend new event (most recent first)
        const updated = [liveTimelineEvent, ...prev];
        
        // Keep max 20 entries
        return updated.slice(0, 20);
      });

      // Update lead status if event has a status and it's different
      if (liveTimelineEvent.status && displayLead && liveTimelineEvent.status !== displayLead.status) {
        try {
          const updatedLead = { ...displayLead, status: liveTimelineEvent.status };
          setDisplayLead(updatedLead);
          
          // Notify parent component of status update
          if (onLeadStatusUpdate) {
            onLeadStatusUpdate(liveTimelineEvent.status);
          }
        } catch (err) {
          console.error('[LeadDrawer] Error updating lead status:', err);
          // Continue execution - don't crash
        }
      }
    } catch (err) {
      console.error('[LeadDrawer] Error processing timeline event:', err);
      // Continue execution - timeline data persists
    }
  }, [liveTimelineEvent, mockMode, displayLead, onLeadStatusUpdate]);

  // Handle ESC key press
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Focus trap and initial focus
  useEffect(() => {
    if (!isOpen || !drawerRef.current) return;

    const drawer = drawerRef.current;
    
    // Focus the close button when drawer opens
    if (closeButtonRef.current) {
      closeButtonRef.current.focus();
    }

    // Get all focusable elements within the drawer
    const getFocusableElements = (): HTMLElement[] => {
      const selector = [
        'a[href]',
        'button:not([disabled])',
        'textarea:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(', ');
      
      return Array.from(drawer.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => !el.hasAttribute('aria-hidden') && !el.closest('[aria-hidden="true"]')
      );
    };

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    drawer.addEventListener('keydown', handleTabKey);

    return () => {
      drawer.removeEventListener('keydown', handleTabKey);
    };
  }, [isOpen]);

  // Restore focus to previous element when drawer closes
  useEffect(() => {
    if (!isOpen && previousFocusElement) {
      // Use setTimeout to ensure the drawer is fully closed before restoring focus
      setTimeout(() => {
        previousFocusElement.focus();
      }, 100);
    }
  }, [isOpen, previousFocusElement]);

  const isHotLead = displayLead?.status === 'HOT';

  // Handle mount/unmount with animation
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      // Trigger animation after mount
      requestAnimationFrame(() => {
        setIsAnimating(true);
      });
    } else {
      setIsAnimating(false);
      // Wait for animation to complete before unmounting
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 200); // Match animation duration
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!shouldRender) return null;

  return (
    <>
      {/* Backdrop with blur */}
      <div
        className={`fixed inset-0 bg-black backdrop-blur-sm z-40 ${
          prefersReducedMotion ? '' : 'transition-opacity duration-200 ease-out'
        } ${isAnimating ? 'opacity-50' : 'opacity-0'}`}
        onClick={onClose}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* STEP 21: Drawer - Right side, responsive */}
      <div
        ref={drawerRef}
        className={`fixed right-0 top-0 h-full w-full sm:max-w-[420px] lg:max-w-[480px] xl:max-w-[480px] bg-white z-50 overflow-y-auto rounded-l-2xl sm:rounded-l-2xl md:rounded-l-2xl lg:rounded-l-2xl shadow-[0_0_24px_rgba(0,0,0,0.12)] ${
          prefersReducedMotion ? '' : 'transition-all duration-200 ease-out'
        } ${isAnimating ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'} ${
          isHotLead ? 'border-l-4 border-red-500' : ''
        }`}
        style={{
          // Mobile: Full-screen modal, Tablet+: Right-side sheet, Laptop+: Overlay
          zIndex: 60
        }}
        role="dialog"
        aria-modal={true}
        aria-labelledby="lead-drawer-title"
      >
        {/* Header */}
        <div className={`sticky top-0 bg-white border-b z-10 ${
          isHotLead ? 'border-red-200 bg-gradient-to-r from-red-50/30 to-white' : 'border-gray-200'
        }`}>
          <div className="px-6 py-5">
            <div className="flex items-center justify-between mb-4">
              <h2 id="lead-drawer-title" className="text-xl font-semibold text-gray-900 tracking-tight">
                Lead Details
              </h2>
              <button
                ref={closeButtonRef}
                onClick={onClose}
                className="text-gray-400 hover:text-gray-700 transition-colors p-1.5 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
                aria-label="Close lead details drawer"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            {displayLead && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className={`text-lg font-semibold tracking-tight ${
                    isHotLead ? 'text-red-900' : 'text-gray-900'
                  }`}>
                    {displayLead.contact?.name || displayLead.contactId || 'Unknown Lead'}
                  </h3>
                  <LeadStatusBadge status={displayLead.status} />
                </div>
                <p className="text-sm text-gray-600 font-medium">
                  {displayLead.contact?.phone || 'No phone number'}
                </p>
              </div>
            )}
            
            {/* STEP 21: Technical badges moved to Advanced Details */}
            
            {/* STEP 23: Live Call Monitor */}
            {displayLead && liveCallData && (
              <div className="mt-3 p-3 bg-red-50 border-2 border-red-300 rounded-lg animate-pulse">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                  <span className="text-xs font-semibold text-red-900 uppercase tracking-wider">
                    LIVE CALL MONITORING
                  </span>
                </div>
                <div className="space-y-3">
                  {/* Live Transcript Summary */}
                  {liveCallData.transcriptSummary && (
                    <div className="p-2 bg-white rounded border border-red-200">
                      <div className="text-xs font-medium text-gray-600 mb-1">Live Transcript</div>
                      <p className="text-sm text-gray-900 leading-relaxed">{liveCallData.transcriptSummary}</p>
                      {liveCallData.lastUpdateAt && (
                        <p className="text-xs text-gray-500 mt-1">
                          Updated: {new Date(liveCallData.lastUpdateAt).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Emotion / Urgency Indicators */}
                  <div className="flex flex-wrap items-center gap-2">
                    {liveCallData.emotion && (
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        liveCallData.emotion === 'frustrated' ? 'bg-red-100 text-red-700' :
                        liveCallData.emotion === 'excited' ? 'bg-green-100 text-green-700' :
                        liveCallData.emotion === 'hesitant' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        Emotion: {liveCallData.emotion}
                      </span>
                    )}
                    {liveCallData.urgencyLevel && (
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        liveCallData.urgencyLevel === 'high' ? 'bg-orange-100 text-orange-700' :
                        liveCallData.urgencyLevel === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        Urgency: {liveCallData.urgencyLevel}
                      </span>
                    )}
                    {liveCallData.riskLevel && (
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        liveCallData.riskLevel === 'HIGH' ? 'bg-red-100 text-red-700 animate-pulse' :
                        liveCallData.riskLevel === 'MEDIUM' ? 'bg-orange-100 text-orange-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        Risk: {liveCallData.riskLevel}
                      </span>
                    )}
                  </div>

                  {/* Detected Objections */}
                  {liveCallData.objections && liveCallData.objections.length > 0 && (
                    <div className="p-2 bg-orange-50 rounded border border-orange-200">
                      <div className="text-xs font-medium text-orange-900 mb-1">Detected Objections</div>
                      <div className="flex flex-wrap gap-1">
                        {liveCallData.objections.map((obj: string, idx: number) => (
                          <span key={idx} className="px-2 py-0.5 text-xs font-medium rounded bg-orange-100 text-orange-700">
                            {obj}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Whisper Suggestions */}
                  {liveCallData.suggestions && liveCallData.suggestions.length > 0 && (
                    <div className="p-2 bg-blue-50 rounded border border-blue-200">
                      <div className="text-xs font-medium text-blue-900 mb-1">Whisper Suggestions</div>
                      <ul className="space-y-1">
                        {liveCallData.suggestions.map((suggestion: string, idx: number) => (
                          <li key={idx} className="text-xs text-gray-700 flex items-start">
                            <span className="text-blue-600 mr-1">•</span>
                            <span>{suggestion}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Emergency Controls */}
                  <div className="flex gap-2 pt-2 border-t border-red-200">
                    <button
                      onClick={async () => {
                        if (!liveCallData.callLogId || mockMode) {
                          alert('(Mock) Call stopped');
                          return;
                        }
                        try {
                          const res = await makeAuthenticatedRequest(`${API_BASE}/call/live/emergency/stop`, {
                            method: 'POST',
                            body: JSON.stringify({ callLogId: liveCallData.callLogId }),
                          });
                          const data = res;
                          if (data.ok) {
                            setLiveCallData(null);
                            alert('Call stopped successfully');
                          } else {
                            alert('Failed to stop call: ' + (data.error || 'Unknown error'));
                          }
                        } catch (err) {
                          console.error('Failed to stop call:', err);
                          alert('Failed to stop call');
                        }
                      }}
                      className="flex-1 px-3 py-2 bg-red-600 text-white text-xs font-semibold rounded hover:bg-red-700 transition-colors"
                    >
                      Stop Call
                    </button>
                    <button
                      onClick={async () => {
                        if (!liveCallData.callLogId || mockMode) {
                          alert('(Mock) Human handoff requested');
                          return;
                        }
                        try {
                          const res = await makeAuthenticatedRequest(`${API_BASE}/call/live/emergency/handoff`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ callLogId: liveCallData.callLogId }),
                          });
                          const data = res;
                          if (data.ok) {
                            alert('Human handoff requested successfully');
                          } else {
                            alert('Failed to request handoff: ' + (data.error || 'Unknown error'));
                          }
                        } catch (err) {
                          console.error('Failed to request handoff:', err);
                          alert('Failed to request handoff');
                        }
                      }}
                      className="flex-1 px-3 py-2 bg-orange-600 text-white text-xs font-semibold rounded hover:bg-orange-700 transition-colors"
                    >
                      Force Handoff
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Voice Strategy */}
            {displayLead && displayLead.voiceStrategy && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-blue-900 uppercase tracking-wider">
                    Voice Strategy
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded ${
                    displayLead.voiceStrategy.voiceTone === 'empathetic'
                      ? 'bg-purple-100 text-purple-700'
                      : displayLead.voiceStrategy.voiceTone === 'assertive'
                      ? 'bg-orange-100 text-orange-700'
                      : displayLead.voiceStrategy.voiceTone === 'soft'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {displayLead.voiceStrategy.voiceTone}
                  </span>
                  <span className={`px-2 py-1 text-xs font-medium rounded ${
                    displayLead.voiceStrategy.speechRate === 'fast'
                      ? 'bg-orange-100 text-orange-700'
                      : displayLead.voiceStrategy.speechRate === 'slow'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {displayLead.voiceStrategy.speechRate}
                  </span>
                  <span className="px-2 py-1 text-xs font-medium rounded bg-indigo-100 text-indigo-700">
                    {displayLead.voiceStrategy.scriptVariant}
                  </span>
                  <span className="px-2 py-1 text-xs font-medium rounded bg-teal-100 text-teal-700">
                    {displayLead.voiceStrategy.language.toUpperCase()}
                  </span>
                </div>
              </div>
            )}

            {/* Adaptive Conversation Step */}
            {displayLead && displayLead.adaptiveStep && (
              <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-purple-900 uppercase tracking-wider">
                    AI Next Action
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${
                      displayLead.adaptiveStep.scriptMode === 'CLOSING'
                        ? 'bg-green-100 text-green-700'
                        : displayLead.adaptiveStep.scriptMode === 'OBJECTION_HANDLING'
                        ? 'bg-violet-100 text-violet-700'
                        : displayLead.adaptiveStep.scriptMode === 'PITCH'
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      {displayLead.adaptiveStep.scriptMode}
                    </span>
                    {displayLead.adaptiveStep.slowDownSpeech && (
                      <span className="px-2 py-1 text-xs font-medium rounded bg-yellow-100 text-yellow-700">
                        Slow Down
                      </span>
                    )}
                    {displayLead.adaptiveStep.interruptAllowed && (
                      <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-700">
                        Interrupt Allowed
                      </span>
                    )}
                    {displayLead.adaptiveStep.confidenceBoost && (
                      <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-700">
                        Confidence Boost
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-700 mt-2">
                    {displayLead.adaptiveStep.nextPromptInstruction}
                  </p>
                </div>
              </div>
            )}

            {/* Learning Strategy (AI Optimized from Past Calls) */}
            {displayLead && displayLead.learningStrategy && (
              <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-emerald-900 uppercase tracking-wider">
                    AI Optimized from Past Calls
                  </span>
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-emerald-100 text-emerald-700">
                    Learning Applied
                  </span>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-gray-600 mb-2">
                    Strategy optimized based on historical successful patterns
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {displayLead.learningStrategy.recommendedScriptMode && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Script:</span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-emerald-100 text-emerald-700">
                          {displayLead.learningStrategy.recommendedScriptMode}
                        </span>
                      </div>
                    )}
                    {displayLead.learningStrategy.recommendedVoiceTone && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Tone:</span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-emerald-100 text-emerald-700">
                          {displayLead.learningStrategy.recommendedVoiceTone}
                        </span>
                      </div>
                    )}
                    {displayLead.learningStrategy.recommendedSpeechRate && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Rate:</span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-emerald-100 text-emerald-700">
                          {displayLead.learningStrategy.recommendedSpeechRate}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 21: Auto-Applied Strategy Section */}
            {displayLead && displayLead.autoAppliedStrategy && !displayLead.humanOverride?.overrideStrategy && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-blue-900 uppercase tracking-wider">
                    Auto Strategy Applied
                  </span>
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-700">
                    Auto
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {displayLead.autoAppliedStrategy.scriptVariant && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Variant:</span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-700">
                          {displayLead.autoAppliedStrategy.scriptVariant}
                        </span>
                      </div>
                    )}
                    {displayLead.autoAppliedStrategy.voiceTone && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Tone:</span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-700">
                          {displayLead.autoAppliedStrategy.voiceTone}
                        </span>
                      </div>
                    )}
                    {displayLead.autoAppliedStrategy.emotion && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Emotion:</span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-700">
                          {displayLead.autoAppliedStrategy.emotion}
                        </span>
                      </div>
                    )}
                    {displayLead.autoAppliedStrategy.urgencyLevel && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Urgency:</span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-700">
                          {displayLead.autoAppliedStrategy.urgencyLevel}
                        </span>
                      </div>
                    )}
                  </div>
                  {displayLead.autoAppliedStrategy.reason && (
                    <p className="text-xs text-gray-600 mt-2">
                      {displayLead.autoAppliedStrategy.reason}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Human Override Section */}
            {displayLead && displayLead.humanOverride && (
              <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-orange-900 uppercase tracking-wider">
                    Human Override Active
                  </span>
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-orange-100 text-orange-700">
                    Manual Control
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {displayLead.humanOverride.scriptMode && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Script:</span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-orange-100 text-orange-700">
                          {displayLead.humanOverride.scriptMode}
                        </span>
                      </div>
                    )}
                    {displayLead.humanOverride.voiceTone && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Tone:</span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-orange-100 text-orange-700">
                          {displayLead.humanOverride.voiceTone}
                        </span>
                      </div>
                    )}
                    {displayLead.humanOverride.speechRate && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Rate:</span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-orange-100 text-orange-700">
                          {displayLead.humanOverride.speechRate}
                        </span>
                      </div>
                    )}
                    {displayLead.humanOverride.followUpChannel && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-600">Follow-up:</span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-orange-100 text-orange-700">
                          {displayLead.humanOverride.followUpChannel}
                        </span>
                      </div>
                    )}
                  </div>
                  {displayLead.humanOverride.overrideReason && (
                    <p className="text-xs text-gray-700 mt-2">
                      <strong>Reason:</strong> {displayLead.humanOverride.overrideReason}
                    </p>
                  )}
                  {displayLead.humanOverride.overriddenBy && (
                    <p className="text-xs text-gray-600 mt-1">
                      Overridden by: {displayLead.humanOverride.overriddenBy}
                      {displayLead.humanOverride.overriddenAt && (
                        <span className="ml-2">
                          • {new Date(displayLead.humanOverride.overriddenAt).toLocaleString()}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6">
          {displayLead ? (
            <div className="space-y-6">
              {/* STEP 21: Simplified Default View */}
              <div className="space-y-4">
                {/* Lead Status */}
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600">Status:</span>
                  <LeadStatusBadge status={displayLead.status} />
                </div>

                {/* Last Call Summary */}
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Last Call Summary</h4>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {getLastCallSummary(displayLead)}
                  </p>
                </div>

                {/* Recommended Next Action */}
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Recommended Next Action</h4>
                  <p className="text-sm text-gray-700 font-medium mb-3">
                    {getRecommendedNextAction(
                      displayLead.outcome 
                        ? { action: displayLead.outcome.action, followUp: displayLead.outcome.followUp }
                        : displayLead.calls?.[0]?.outcomeBucket 
                        ? {
                            action: displayLead.status === 'HOT' ? 'HUMAN_HANDOFF' : displayLead.status === 'WARM' ? 'FOLLOW_UP' : displayLead.status === 'COLD' ? 'NURTURE' : 'DROP',
                            followUp: displayLead.status === 'WARM' ? 'CALL_24H' : undefined
                          }
                        : null
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(displayLead.status === 'WARM' || displayLead.status === 'HOT') && (
                      <button
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
                        onClick={onStartCall}
                      >
                        Start Follow-up Call
                      </button>
                    )}
                    {displayLead.status === 'HOT' && (
                      <button
                        className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 transition-colors"
                        onClick={async () => {
                          if (mockMode) {
                            alert('(Mock) Lead marked as converted');
                            return;
                          }
                          try {
                            const data = await makeAuthenticatedRequest(`${API_BASE}/leads/${displayLead.id}/convert`, {
                              method: 'POST',
                            });
                            if (data.ok) {
                              alert('Lead marked as converted');
                            }
                          } catch (err) {
                            console.error('Failed to convert lead:', err);
                            alert('Failed to convert lead');
                          }
                        }}
                      >
                        Mark as Converted
                      </button>
                    )}
                    <button
                      className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded hover:bg-gray-700 transition-colors"
                      onClick={onStartCall}
                    >
                      Start New Call
                    </button>
                  </div>
                </div>
              </div>

              {/* STEP 21: Advanced Details (Collapsible) */}
              <div className="border-t border-gray-200 pt-6">
                <button
                  onClick={() => setShowAdvancedDetails(!showAdvancedDetails)}
                  className="w-full flex items-center justify-between text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors"
                >
                  <span>Advanced Details</span>
                  <svg
                    className={`w-5 h-5 transition-transform ${showAdvancedDetails ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {showAdvancedDetails && (
                  <div className="mt-4 space-y-7">
                    {/* Agent Control Panel */}
                    <div>
                      <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-4">
                        Agent Control Panel
                      </h3>
                
                      {/* Quick Action Buttons */}
                      <div className="mb-5 p-4 bg-blue-50/60 border border-blue-100 rounded-lg shadow-sm">
                        <div className="text-xs font-semibold text-gray-900 mb-3">Quick Actions</div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                            onClick={() => {
                              if (!displayLead) return;
                              setShowConfirmDialog({
                                action: 'stopBatch',
                                message: 'This will immediately stop all active batch jobs for this campaign. Continue?',
                                onConfirm: async () => {
                                  if (mockMode) {
                                    alert('(Mock) Batch stopped');
                                    setShowConfirmDialog(null);
                                    return;
                                  }
                                  try {
                                    const data = await makeAuthenticatedRequest(`${API_BASE}/leads/${displayLead.id}/override`, {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        stopBatch: true,
                                        overrideReason: 'Human override: Stop batch',
                                        overriddenBy: overrideForm.overriddenBy || 'Operator',
                                      }),
                                    });
                                    if (data.ok) {
                                      alert('Batch stopped successfully');
                                    }
                                  } catch (err) {
                                    console.error('Failed to stop batch:', err);
                                    alert('Failed to stop batch');
                                  }
                                  setShowConfirmDialog(null);
                                },
                              });
                            }}
                          >
                            Stop Batch
                          </button>
                          <button
                            className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-700 disabled:opacity-50"
                            onClick={() => {
                              if (!displayLead) return;
                              setShowConfirmDialog({
                                action: 'endCall',
                                message: 'This will immediately end the current call if one is active. Continue?',
                                onConfirm: async () => {
                                  if (mockMode) {
                                    alert('(Mock) Call ended');
                                    setShowConfirmDialog(null);
                                    return;
                                  }
                                  try {
                                    const data = await makeAuthenticatedRequest(`${API_BASE}/leads/${displayLead.id}/override`, {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        stopCurrentCall: true,
                                        overrideReason: 'Human override: End call',
                                        overriddenBy: overrideForm.overriddenBy || 'Operator',
                                      }),
                                    });
                                    if (data.ok) {
                                      alert('Call ended successfully');
                                    }
                                  } catch (err) {
                                    console.error('Failed to end call:', err);
                                    alert('Failed to end call');
                                  }
                                  setShowConfirmDialog(null);
                                },
                              });
                            }}
                          >
                            End Call
                          </button>
                          <button
                            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                            onClick={() => {
                              if (!displayLead) return;
                              setShowConfirmDialog({
                                action: 'forceHOT',
                                message: 'This will immediately mark this lead as HOT. Continue?',
                                onConfirm: async () => {
                                  if (mockMode) {
                                    alert('(Mock) Lead marked as HOT');
                                    setShowConfirmDialog(null);
                                    return;
                                  }
                                  try {
                                    const data = await makeAuthenticatedRequest(`${API_BASE}/leads/${displayLead.id}/override`, {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        status: 'HOT',
                                        overrideReason: 'Human override: Force HOT status',
                                        overriddenBy: overrideForm.overriddenBy || 'Operator',
                                      }),
                                    });
                                    if (data.ok) {
                                      setDisplayLead({ ...displayLead, status: 'HOT' });
                                      if (onLeadStatusUpdate) {
                                        onLeadStatusUpdate('HOT');
                                      }
                                      alert('Lead marked as HOT');
                                    }
                                  } catch (err) {
                                    console.error('Failed to update status:', err);
                                    alert('Failed to update status');
                                  }
                                  setShowConfirmDialog(null);
                                },
                              });
                            }}
                          >
                            Force HOT
                          </button>
                          <button
                            className="px-3 py-1.5 bg-slate-600 text-white text-xs font-medium rounded hover:bg-slate-700 disabled:opacity-50 transition-colors"
                            onClick={() => {
                              if (!displayLead) return;
                              setShowConfirmDialog({
                                action: 'dropLead',
                                message: 'This will mark this lead as COLD (dropped). Continue?',
                                onConfirm: async () => {
                                  if (mockMode) {
                                    alert('(Mock) Lead dropped');
                                    setShowConfirmDialog(null);
                                    return;
                                  }
                                  try {
                                    const data = await makeAuthenticatedRequest(`${API_BASE}/leads/${displayLead.id}/override`, {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        status: 'COLD',
                                        overrideReason: 'Human override: Drop lead',
                                        overriddenBy: overrideForm.overriddenBy || 'Operator',
                                      }),
                                    });
                                    if (data.ok) {
                                      setDisplayLead({ ...displayLead, status: 'COLD' });
                                      if (onLeadStatusUpdate) {
                                        onLeadStatusUpdate('COLD');
                                      }
                                      alert('Lead dropped');
                                    }
                                  } catch (err) {
                                    console.error('Failed to drop lead:', err);
                                    alert('Failed to drop lead');
                                  }
                                  setShowConfirmDialog(null);
                                },
                              });
                            }}
                          >
                            Drop Lead
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 p-4 bg-gray-50/40 rounded-lg border border-gray-200/50" data-section="override">
                      <div className="text-xs text-gray-500 font-medium mb-3 opacity-75">Strategy Override Settings</div>
                      
                      {/* STEP 21: Auto-Strategy Override Toggle */}
                      <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200">
                        <div>
                          <label htmlFor="overrideStrategy" className="text-xs font-medium text-gray-700 block mb-1">
                            Disable Auto Strategy for this lead
                          </label>
                          <p className="text-xs text-gray-500">
                            When enabled, auto-applied strategies will be skipped for this lead
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          id="overrideStrategy"
                          className="w-5 h-5 text-orange-600 rounded focus:ring-orange-500"
                          checked={overrideForm.overrideStrategy || false}
                          onChange={(e) => setOverrideForm({ ...overrideForm, overrideStrategy: e.target.checked })}
                        />
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gray-600 font-medium mb-1">Script Mode</label>
                          <select
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            value={overrideForm.scriptMode}
                            onChange={(e) => setOverrideForm({ ...overrideForm, scriptMode: e.target.value })}
                          >
                            <option value="">AI Default</option>
                            <option value="DISCOVERY">DISCOVERY</option>
                            <option value="PITCH">PITCH</option>
                            <option value="OBJECTION_HANDLING">OBJECTION_HANDLING</option>
                            <option value="CLOSING">CLOSING</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 font-medium mb-1">Script Variant</label>
                          <select
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            value={overrideForm.scriptVariant}
                            onChange={(e) => setOverrideForm({ ...overrideForm, scriptVariant: e.target.value })}
                          >
                            <option value="">AI Default</option>
                            <option value="DISCOVERY_SOFT">DISCOVERY_SOFT</option>
                            <option value="DISCOVERY_DIRECT">DISCOVERY_DIRECT</option>
                            <option value="OBJECTION_CALM">OBJECTION_CALM</option>
                            <option value="OBJECTION_EMPATHETIC">OBJECTION_EMPATHETIC</option>
                            <option value="CLOSING_CONFIDENT">CLOSING_CONFIDENT</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 font-medium mb-1">Voice Tone</label>
                          <select
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            value={overrideForm.voiceTone}
                            onChange={(e) => setOverrideForm({ ...overrideForm, voiceTone: e.target.value })}
                          >
                            <option value="">AI Default</option>
                            <option value="soft">Soft</option>
                            <option value="neutral">Neutral</option>
                            <option value="assertive">Assertive</option>
                            <option value="empathetic">Empathetic</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 font-medium mb-1">Speech Rate</label>
                          <select
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            value={overrideForm.speechRate}
                            onChange={(e) => setOverrideForm({ ...overrideForm, speechRate: e.target.value })}
                          >
                            <option value="">AI Default</option>
                            <option value="slow">Slow</option>
                            <option value="normal">Normal</option>
                            <option value="fast">Fast</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 font-medium mb-1">Follow-up Channel</label>
                          <select
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            value={overrideForm.followUpChannel}
                            onChange={(e) => setOverrideForm({ ...overrideForm, followUpChannel: e.target.value })}
                          >
                            <option value="">AI Default</option>
                            <option value="call">Call</option>
                            <option value="whatsapp">WhatsApp</option>
                            <option value="email">Email</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 font-medium mb-1">Follow-up After (hours)</label>
                          <input
                            type="number"
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            value={overrideForm.followUpAfterHours}
                            onChange={(e) => setOverrideForm({ ...overrideForm, followUpAfterHours: e.target.value })}
                            placeholder="e.g., 24"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 font-medium mb-1">Follow-up Message Intent</label>
                          <input
                            type="text"
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            value={overrideForm.followUpMessageIntent}
                            onChange={(e) => setOverrideForm({ ...overrideForm, followUpMessageIntent: e.target.value })}
                            placeholder="e.g., Follow up on pricing question"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 font-medium mb-1">Status Override</label>
                          <select
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            value={overrideForm.status}
                            onChange={(e) => setOverrideForm({ ...overrideForm, status: e.target.value })}
                          >
                            <option value="">AI Default</option>
                            <option value="NOT_PICK">NOT_PICK</option>
                            <option value="COLD">COLD</option>
                            <option value="WARM">WARM</option>
                            <option value="HOT">HOT</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="forceHandoff"
                            className="w-4 h-4"
                            checked={overrideForm.forceHandoff}
                            onChange={(e) => setOverrideForm({ ...overrideForm, forceHandoff: e.target.checked })}
                          />
                          <label htmlFor="forceHandoff" className="text-xs text-gray-600 font-medium">
                            Force Handoff
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 font-medium mb-1">Your Name</label>
                          <input
                            type="text"
                            className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                            value={overrideForm.overriddenBy}
                            onChange={(e) => setOverrideForm({ ...overrideForm, overriddenBy: e.target.value })}
                            placeholder="Agent name"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 font-medium mb-1">Override Reason</label>
                        <textarea
                          className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
                          rows={2}
                          value={overrideForm.overrideReason}
                          onChange={(e) => setOverrideForm({ ...overrideForm, overrideReason: e.target.value })}
                          placeholder="Why are you overriding AI decisions?"
                        />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          className="px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          onClick={async () => {
                            if (!displayLead || mockMode) {
                              alert('(Mock) Override saved');
                              return;
                            }
                            setIsSavingOverride(true);
                            try {
                              const overrideData: any = {};
                              if (overrideForm.scriptMode) overrideData.scriptMode = overrideForm.scriptMode;
                              if (overrideForm.scriptVariant) overrideData.scriptVariant = overrideForm.scriptVariant;
                              if (overrideForm.voiceTone) overrideData.voiceTone = overrideForm.voiceTone;
                              if (overrideForm.speechRate) overrideData.speechRate = overrideForm.speechRate;
                              if (overrideForm.followUpChannel) overrideData.followUpChannel = overrideForm.followUpChannel;
                              if (overrideForm.followUpAfterHours) overrideData.followUpAfterHours = parseInt(overrideForm.followUpAfterHours);
                              if (overrideForm.followUpMessageIntent) overrideData.followUpMessageIntent = overrideForm.followUpMessageIntent;
                              if (overrideForm.status) overrideData.status = overrideForm.status;
                              if (overrideForm.forceHandoff !== undefined) overrideData.forceHandoff = overrideForm.forceHandoff;
                              if (overrideForm.overrideStrategy !== undefined) overrideData.overrideStrategy = overrideForm.overrideStrategy; // STEP 21
                              if (overrideForm.overrideReason) overrideData.overrideReason = overrideForm.overrideReason;
                              if (overrideForm.overriddenBy) overrideData.overriddenBy = overrideForm.overriddenBy;
                              
                              const data = await makeAuthenticatedRequest(`${API_BASE}/leads/${displayLead.id}/override`, {
                                method: 'POST',
                                body: JSON.stringify(overrideData),
                              });
                              if (data.ok) {
                                // Update local state
                                setDisplayLead({
                                  ...displayLead,
                                  humanOverride: data.override,
                                });
                              }
                            } catch (err: any) {
                              console.error('Failed to save override:', err);
                              if (err?.message?.includes('401') || err?.message?.includes('Authentication required')) {
                                alert('Authentication required. Please sign in.');
                              } else {
                                alert('Failed to save override');
                              }
                            } finally {
                              setIsSavingOverride(false);
                            }
                          }}
                          disabled={isSavingOverride}
                        >
                          {isSavingOverride ? 'Saving...' : 'Save Override'}
                        </button>
                        {displayLead.humanOverride && (
                          <button
                            className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300 disabled:opacity-50 transition-colors"
                            onClick={async () => {
                              if (!displayLead || mockMode) {
                                alert('(Mock) Override removed');
                                return;
                              }
                              try {
                                const data = await makeAuthenticatedRequest(`${API_BASE}/leads/${displayLead.id}/override`, {
                                  method: 'DELETE',
                                });
                                if (data.ok) {
                                  setDisplayLead({
                                    ...displayLead,
                                    humanOverride: undefined,
                                  });
                                  setOverrideForm({
                                    scriptMode: '',
                                    scriptVariant: '',
                                    voiceTone: '',
                                    speechRate: '',
                                    followUpChannel: '',
                                    followUpAfterHours: '',
                                    followUpMessageIntent: '',
                                    status: '',
                                    forceHandoff: false,
                                    stopBatch: false,
                                    stopCurrentCall: false,
                                    overrideStrategy: false,
                                    overrideReason: '',
                                    overriddenBy: '',
                                  });
                                }
                              } catch (err) {
                                console.error('Failed to remove override:', err);
                                alert('Failed to remove override');
                              }
                            }}
                          >
                            Remove Override
                          </button>
                        )}
                      </div>

                      {/* Lead Meta */}
                      <div>
                        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-4">
                          Lead Meta
                        </h3>
                        <div className="space-y-3.5">
                          <div>
                            <span className="text-xs text-gray-500 font-medium block mb-1">Campaign</span>
                            <p className="text-sm text-gray-900 font-medium">
                              {campaignName || displayLead.campaignId || 'N/A'}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-gray-500 font-medium block mb-1">Last Call</span>
                            <p className="text-sm text-gray-900 font-medium min-h-[1.25rem]">
                              {displayLead.lastCallAt 
                                ? new Date(displayLead.lastCallAt).toLocaleString() 
                                : 'Never called'}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs text-gray-500 font-medium block mb-1">Lead ID</span>
                            <p className="text-xs text-gray-400 font-mono">
                              {displayLead.id}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* AI Summary (Mock Mode only) */}
                      {mockMode && (
                        <div>
                          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-4">
                            AI Call Summary
                          </h3>
                          <div className={`rounded-lg p-4 border ${
                            isHotLead 
                              ? 'bg-red-50/50 border-red-200' 
                              : 'bg-gray-50 border-gray-200'
                          }`}>
                            <p className="text-sm text-gray-700 leading-relaxed">
                              The lead expressed moderate interest during the initial call. 
                              They mentioned they are currently looking for properties in the area 
                              and would like to schedule a viewing. The conversation was positive, 
                              with the lead asking about pricing and availability. Recommended 
                              follow-up within 24-48 hours to maintain engagement.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* STEP 24: Call Detail View */}
                      {selectedCallId && callReview && (
                        <div className="mb-6 p-4 bg-gradient-to-br from-purple-50 to-blue-50 border-2 border-purple-200 rounded-lg">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-purple-900 uppercase tracking-wider">
                              AI Self-Critique
                            </h3>
                            <button
                              onClick={() => {
                                setSelectedCallId(null);
                                setCallReview(null);
                              }}
                              className="text-purple-600 hover:text-purple-800 text-xs font-medium"
                            >
                              Close
                            </button>
                          </div>

                          {/* Overall Assessment */}
                          <div className="mb-4 p-3 bg-white rounded-lg border border-purple-200">
                            <div className="text-xs font-semibold text-gray-700 mb-2">Overall Assessment</div>
                            <p className="text-sm text-gray-900 leading-relaxed">{callReview.overallAssessment}</p>
                          </div>

                          {/* Strengths */}
                          <div className="mb-4 p-3 bg-green-50 rounded-lg border border-green-200">
                            <div className="text-xs font-semibold text-green-900 mb-2 flex items-center gap-2">
                              <span>✓</span>
                              <span>What Worked Well</span>
                            </div>
                            <ul className="space-y-1.5">
                              {callReview.strengths.map((strength: string, idx: number) => (
                                <li key={idx} className="text-sm text-gray-800 flex items-start">
                                  <span className="text-green-600 mr-2">•</span>
                                  <span>{strength}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Improvements */}
                          <div className="mb-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
                            <div className="text-xs font-semibold text-amber-900 mb-2 flex items-center gap-2">
                              <span>⚠</span>
                              <span>What Could Improve</span>
                            </div>
                            <ul className="space-y-1.5">
                              {callReview.improvements.map((improvement: string, idx: number) => (
                                <li key={idx} className="text-sm text-gray-800 flex items-start">
                                  <span className="text-amber-600 mr-2">•</span>
                                  <span>{improvement}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Next Time Actions */}
                          <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                            <div className="text-xs font-semibold text-blue-900 mb-2 flex items-center gap-2">
                              <span>→</span>
                              <span>What AI Will Do Differently Next Time</span>
                            </div>
                            <ul className="space-y-1.5">
                              {callReview.nextTimeActions.map((action: string, idx: number) => (
                                <li key={idx} className="text-sm text-gray-800 flex items-start">
                                  <span className="text-blue-600 mr-2">•</span>
                                  <span>{action}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Prediction Accuracy */}
                          <div className="mb-4 p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                            <div className="text-xs font-semibold text-indigo-900 mb-2">Prediction Accuracy</div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`px-2 py-1 text-xs font-medium rounded ${
                                callReview.predictionAccuracy.status === 'ACCURATE' ? 'bg-green-100 text-green-700' :
                                callReview.predictionAccuracy.status === 'OVERESTIMATED' ? 'bg-orange-100 text-orange-700' :
                                'bg-blue-100 text-blue-700'
                              }`}>
                                {callReview.predictionAccuracy.status}
                              </span>
                              {callReview.predictionAccuracy.predictedBucket && (
                                <span className="text-xs text-gray-600">
                                  Predicted: {callReview.predictionAccuracy.predictedBucket}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-700">{callReview.predictionAccuracy.explanation}</p>
                          </div>

                          {/* Key Learnings */}
                          <div className="mb-4 p-3 bg-teal-50 rounded-lg border border-teal-200">
                            <div className="text-xs font-semibold text-teal-900 mb-2">Key Learnings</div>
                            <ul className="space-y-1.5">
                              {callReview.keyLearnings.map((learning: string, idx: number) => (
                                <li key={idx} className="text-sm text-gray-800 flex items-start">
                                  <span className="text-teal-600 mr-2">•</span>
                                  <span>{learning}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* Human Feedback Input */}
                          <div className="p-3 bg-white rounded-lg border border-gray-200">
                            <div className="text-xs font-semibold text-gray-700 mb-2">Human Feedback (Optional)</div>
                            <textarea
                              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 mb-2"
                              rows={3}
                              value={humanFeedback}
                              onChange={(e) => setHumanFeedback(e.target.value)}
                              placeholder="Add your feedback on this call review..."
                            />
                            <button
                              onClick={async () => {
                                if (!humanFeedback.trim() || mockMode) {
                                  if (mockMode) {
                                    alert('(Mock) Feedback saved');
                                  }
                                  return;
                                }
                                try {
                                  // Store feedback (could be added to a feedback endpoint later)
                                  alert('Feedback saved (feature to be implemented)');
                                  setHumanFeedback('');
                                } catch (err) {
                                  console.error('Failed to save feedback:', err);
                                  alert('Failed to save feedback');
                                }
                              }}
                              className="px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded hover:bg-purple-700 transition-colors"
                            >
                              Save Feedback
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Call Timeline - Keep visible */}
              <div className="border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Call Timeline
                  </h3>
                  {!mockMode && isLiveConnected && (
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 border border-green-200 rounded-md">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                      <span className="text-xs font-medium text-green-700">Live updating…</span>
                    </div>
                  )}
                </div>
                {timelineEvents.length > 0 ? (
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>
                    
                    <div className="space-y-0">
                      {timelineEvents.map((event, index) => {
                        const isNewest = event.id === newestEventId;
                        const eventConfig = (() => {
                          if (event.type === 'CALL_STARTED') {
                            return {
                              label: 'Call Started',
                              icon: (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                              ),
                              color: 'text-blue-600',
                              bgColor: 'bg-blue-100',
                            };
                          } else if (event.type === 'CALL_ENDED') {
                            return {
                              label: 'Call Ended',
                              icon: (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-1a2 2 0 00-2-2h-1.636A8.962 8.962 0 0019 12a9 9 0 00-2.636-6.364M5 3H3a2 2 0 00-2 2v1a2 2 0 002 2h.636A8.962 8.962 0 003 12a8.962 8.962 0 002.364 6.364M5 3v2.636A8.962 8.962 0 003 12a8.962 8.962 0 002.364 6.364" />
                                </svg>
                              ),
                              color: 'text-gray-600',
                              bgColor: 'bg-gray-100',
                            };
                          } else {
                            // LEAD_UPDATED - color based on status
                            const statusColors = {
                              'NOT_PICK': { color: 'text-gray-600', bgColor: 'bg-gray-100' },
                              'COLD': { color: 'text-blue-600', bgColor: 'bg-blue-100' },
                              'WARM': { color: 'text-yellow-600', bgColor: 'bg-yellow-100' },
                              'HOT': { color: 'text-red-600', bgColor: 'bg-red-100' },
                            };
                            const statusConfig = statusColors[event.status || 'NOT_PICK'] || statusColors['NOT_PICK'];
                            
                            return {
                              label: 'Lead Updated',
                              icon: (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              ),
                              color: statusConfig.color,
                              bgColor: statusConfig.bgColor,
                            };
                          }
                        })();

                        return (
                          <div
                            key={event.id}
                            className={`relative pl-12 pb-6 ${
                              isNewest ? 'animate-pulse' : ''
                            }`}
                          >
                            <div className="absolute left-3 top-1 flex items-center justify-center w-6 h-6 rounded-full bg-white border-2 border-gray-300 z-10">
                              <div className={`w-2 h-2 rounded-full ${eventConfig.bgColor.replace('bg-', 'bg-')}`}></div>
                            </div>
                            <div className={`p-3 rounded-lg border ${eventConfig.bgColor} border-gray-200`}>
                              <div className="flex items-center gap-2 mb-1.5">
                                {eventConfig.icon}
                                <span className={`text-xs font-semibold ${eventConfig.color}`}>
                                  {eventConfig.label}
                                </span>
                                <span className="text-xs text-gray-500 ml-auto">
                                  {new Date(event.timestamp).toLocaleString()}
                                </span>
                              </div>
                              {event.status && (
                                <div className="mt-2.5">
                                  <LeadStatusBadge status={event.status} />
                                </div>
                              )}
                              {event.type === 'CALL_ENDED' && event.callLogId && (
                                <div className="mt-2.5">
                                  <button
                                    onClick={async () => {
                                      if (mockMode) {
                                        setCallReview({
                                          strengths: ['Maintained engagement', 'Handled objections well'],
                                          improvements: ['Could have moved faster to closing'],
                                          nextTimeActions: ['Apply closing strategy earlier'],
                                          predictionAccuracy: {
                                            status: 'ACCURATE',
                                            explanation: 'Prediction matched actual outcome',
                                          },
                                          overallAssessment: 'This was a successful call with good engagement.',
                                          keyLearnings: ['High question count indicates strong interest'],
                                        });
                                        setSelectedCallId(event.callLogId || null);
                                        return;
                                      }
                                      try {
                                        const data = await makeAuthenticatedRequest(`${API_BASE}/call/${event.callLogId}/review`);
                                        if (data.ok && data.selfReview) {
                                          setCallReview(data.selfReview);
                                          setSelectedCallId(event.callLogId || null);
                                        } else {
                                          alert('Review not available for this call');
                                        }
                                      } catch (err) {
                                        console.error('Failed to load review:', err);
                                        alert('Failed to load review');
                                      }
                                    }}
                                    className="px-2 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded hover:bg-purple-200 transition-colors"
                                  >
                                    View AI Review
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-10 text-sm text-gray-500 border border-gray-200 rounded-lg bg-gray-50/50">
                    No timeline events available
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500">No lead selected</p>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
        {showConfirmDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-2">Confirm Action</h3>
              <p className="text-sm text-gray-700 mb-4">{showConfirmDialog.message}</p>
              <div className="flex gap-3 justify-end">
                <button
                  className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300"
                  onClick={() => setShowConfirmDialog(null)}
                >
                  Cancel
                </button>
                <button
                  className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700"
                  onClick={showConfirmDialog.onConfirm}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 22: Preview Call Modal */}
        {showPreviewModal && previewData && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowPreviewModal(false)}>
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold text-gray-900">Call Preview</h3>
                <button
                  onClick={() => setShowPreviewModal(false)}
                  className="text-gray-400 hover:text-gray-700 transition-colors p-1.5 rounded-lg hover:bg-gray-100"
                  aria-label="Close preview"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Caller Identity */}
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="text-xs font-semibold text-blue-900 uppercase tracking-wider mb-2">Caller Identity</div>
                <div className="text-sm text-gray-700">
                  {previewData.callerIdentity.mode === 'PERSONALIZED' && previewData.callerIdentity.name
                    ? `Calling on behalf of ${previewData.callerIdentity.name}`
                    : 'Generic automated call'}
                </div>
              </div>

              {/* Strategy Badges */}
              <div className="mb-4 flex flex-wrap gap-2">
                <span className={`px-2 py-1 text-xs font-medium rounded ${
                  previewData.voiceTone === 'empathetic' ? 'bg-purple-100 text-purple-700' :
                  previewData.voiceTone === 'assertive' ? 'bg-orange-100 text-orange-700' :
                  previewData.voiceTone === 'soft' ? 'bg-green-100 text-green-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  Tone: {previewData.voiceTone}
                </span>
                <span className="px-2 py-1 text-xs font-medium rounded bg-indigo-100 text-indigo-700">
                  Variant: {previewData.scriptVariant}
                </span>
                <span className="px-2 py-1 text-xs font-medium rounded bg-teal-100 text-teal-700">
                  Language: {previewData.language.toUpperCase()}
                </span>
                {previewData.emotion && (
                  <span className="px-2 py-1 text-xs font-medium rounded bg-yellow-100 text-yellow-700">
                    Emotion: {previewData.emotion}
                  </span>
                )}
                {previewData.urgencyLevel && (
                  <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-700">
                    Urgency: {previewData.urgencyLevel}
                  </span>
                )}
                <span className={`px-2 py-1 text-xs font-medium rounded ${
                  previewData.strategySource === 'HUMAN_OVERRIDE' ? 'bg-orange-100 text-orange-700' :
                  previewData.strategySource === 'AUTO_APPLIED' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  Source: {previewData.strategySource}
                </span>
              </div>

              {/* Script Breakdown */}
              <div className="space-y-4">
                {/* Opening */}
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Opening</div>
                  <p className="text-sm text-gray-900 leading-relaxed">{previewData.openingLine}</p>
                </div>

                {/* Main Pitch */}
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="text-xs font-semibold text-blue-900 uppercase tracking-wider mb-2">Main Pitch</div>
                  <ul className="space-y-2">
                    {previewData.mainPitch.map((pitch: string, index: number) => (
                      <li key={index} className="text-sm text-gray-900 flex items-start">
                        <span className="text-blue-600 mr-2">•</span>
                        <span>{pitch}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Closing / CTA */}
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-xs font-semibold text-green-900 uppercase tracking-wider mb-2">Call to Action</div>
                  <p className="text-sm text-gray-900 leading-relaxed">{previewData.closingLine}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="mt-6 flex gap-3 justify-end">
                <button
                  onClick={() => setShowPreviewModal(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    setShowPreviewModal(false);
                    // Scroll to override section
                    const overrideSection = document.querySelector('[data-section="override"]');
                    if (overrideSection) {
                      overrideSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      // Focus on first override field
                      setTimeout(() => {
                        const firstInput = overrideSection.querySelector('select, input');
                        if (firstInput instanceof HTMLElement) {
                          firstInput.focus();
                        }
                      }, 500);
                    }
                  }}
                  className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded hover:bg-orange-700 transition-colors"
                >
                  Override Strategy
                </button>
                {onStartCall && (
                  <button
                    onClick={() => {
                      setShowPreviewModal(false);
                      onStartCall();
                    }}
                    disabled={mockMode}
                    className={`px-4 py-2 text-white text-sm font-medium rounded transition-colors ${
                      mockMode
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-green-600 hover:bg-green-700'
                    }`}
                  >
                    Start Call
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }
