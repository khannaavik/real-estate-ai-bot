// pages/index.tsx
import React, { useEffect, useState, useRef } from "react";
import { useAuth, SignInButton, UserButton } from "@clerk/nextjs";
import { useRouter } from "next/router";
import { getApiBaseUrl, authenticatedFetch } from "../utils/api";
import { useLiveEvents, type SSEEvent } from "../hooks/useLiveEvents";
import { LeadStatusBadge, type LeadStatus } from "../components/LeadStatusBadge";
import { LeadDrawer } from "../components/LeadDrawer";
import { BatchControlBar } from "../components/BatchControlBar";
import type { LeadTimelineEvent } from "../types/lead";
import type { CampaignContact, Contact } from "@/types/campaign";


type Campaign = { 
  id: string; 
  name: string; 
  propertyId: string;
  totalLeads?: number;
  warmLeadsCount?: number;
  hotLeadsCount?: number;
};

async function safeFetch(input: RequestInfo, init?: RequestInit, timeoutMs = 8000, token?: string | null) {
  const url = typeof input === 'string' ? input : input.toString();
  console.log("[FETCH] Request:", init?.method || 'GET', url);
  console.log("[FETCH] Has token:", !!token);
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Conditionally add Authorization header if token is provided
    const headers: HeadersInit = {
      ...(init?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    
    const res = await fetch(input, { ...init, headers, signal: controller.signal });
    clearTimeout(id);
    console.log("[FETCH] Response:", res.status, res.statusText);
    
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[FETCH] Error response:", res.status, text);
      throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const jsonData = await res.json();
      return jsonData;
    }
    const textData = await res.text();
    return textData;
  } catch (err: any) {
    console.error("[FETCH] Exception:", err?.message || err);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

export default function Home() {
  const router = useRouter();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<CampaignContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [activeCallLogId, setActiveCallLogId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [durationSeconds, setDurationSeconds] = useState<number>(90);
  const [backendHealth, setBackendHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'required'>('checking');
  const [selectedLead, setSelectedLead] = useState<CampaignContact | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const previousFocusElementRef = React.useRef<HTMLElement | null>(null);
  const [latestTimelineEvent, setLatestTimelineEvent] = useState<LeadTimelineEvent | null>(null);
  const [showAddLeadModal, setShowAddLeadModal] = useState(false);
  const [addLeadForm, setAddLeadForm] = useState({ name: '', phone: '' });
  const [isAddingLead, setIsAddingLead] = useState(false);
  const [showNewCampaignModal, setShowNewCampaignModal] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [knowledgeSource, setKnowledgeSource] = useState<'MANUAL' | 'VOICE' | null>(null);
  const [newCampaignForm, setNewCampaignForm] = useState({ 
    name: '', 
    propertyId: '',
    callerIdentityMode: 'GENERIC' as 'GENERIC' | 'PERSONALIZED',
    callerDisplayName: '',
    campaignKnowledge: {
      priceRange: '',
      amenities: [] as string[],
      location: '',
      possession: '',
      highlights: [] as string[],
    },
    voiceTranscript: '',
    voiceTranscriptLanguage: null as 'en' | 'hi' | 'hinglish' | null,
    voiceKnowledge: null as {
      safeTalkingPoints?: string[];
      idealBuyerProfile?: string;
      objectionsLikely?: string[];
      pricingConfidence?: 'LOW' | 'MEDIUM' | 'HIGH';
      doNotSay?: string[];
    } | null,
    knowledgeUsageMode: 'INTERNAL_ONLY' as 'INTERNAL_ONLY' | 'PUBLIC',
  });
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isGeneratingKnowledge, setIsGeneratingKnowledge] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [isCreatingCampaign, setIsCreatingCampaign] = useState(false);
  const [campaignFormError, setCampaignFormError] = useState<string | null>(null);
  const [showCsvUploadModal, setShowCsvUploadModal] = useState(false);
  const [showLowInterestLeads, setShowLowInterestLeads] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('callbot_show_low_interest') === 'true';
    }
    return false;
  });
  const [csvUploadSuccessBanner, setCsvUploadSuccessBanner] = useState<{ leadCount: number } | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isUploadingCsv, setIsUploadingCsv] = useState(false);
  const [csvUploadProgress, setCsvUploadProgress] = useState<string | null>(null);
  const [csvUploadSuccess, setCsvUploadSuccess] = useState<{ leadCount: number } | null>(null);
  const [isStartingBatch, setIsStartingBatch] = useState(false);
  
  // Responsive UI state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [campaignDrawerOpen, setCampaignDrawerOpen] = useState(false);
  const [campaignDrawerAnimating, setCampaignDrawerAnimating] = useState(false);
  const [campaignDrawerShouldRender, setCampaignDrawerShouldRender] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const previousFocusElement = useRef<HTMLElement | null>(null);

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

  // Handle campaign drawer animation, focus management, and body scroll lock
  useEffect(() => {
    if (campaignDrawerOpen) {
      // Lock body scroll
      document.body.style.overflow = 'hidden';
      // Store the currently focused element
      previousFocusElement.current = document.activeElement as HTMLElement;
      setCampaignDrawerShouldRender(true);
      // Trigger animation after mount
      requestAnimationFrame(() => {
        setCampaignDrawerAnimating(true);
        // Focus the drawer after animation starts
        if (drawerRef.current) {
          const firstFocusable = drawerRef.current.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (firstFocusable) {
            firstFocusable.focus();
          }
        }
      });
    } else {
      // Unlock body scroll
      document.body.style.overflow = '';
      setCampaignDrawerAnimating(false);
      // Wait for animation to complete before unmounting
      const timer = setTimeout(() => {
        setCampaignDrawerShouldRender(false);
        // Restore focus to previous element
        if (previousFocusElement.current) {
          previousFocusElement.current.focus();
        }
      }, 300); // Match animation duration
      return () => clearTimeout(timer);
    }
  }, [campaignDrawerOpen]);

  // Handle ESC key to close drawer
  useEffect(() => {
    if (!campaignDrawerOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCampaignDrawerOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [campaignDrawerOpen]);

  // Focus trap inside drawer
  useEffect(() => {
    if (!campaignDrawerOpen || !drawerRef.current) return;

    const drawer = drawerRef.current;
    const focusableElements = drawer.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    drawer.addEventListener('keydown', handleTabKey);
    return () => drawer.removeEventListener('keydown', handleTabKey);
  }, [campaignDrawerOpen]);
  
  // Batch call orchestrator state
  const [batchJob, setBatchJob] = useState<{
    batchJobId: string | null;
    status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | null;
    currentIndex: number;
    totalLeads: number;
    pausedAt?: string | null;
  } | null>(null);
  const [batchLogs, setBatchLogs] = useState<string[]>([]);
  const [batchActionLoading, setBatchActionLoading] = useState(false);
  
  // Load Mock Mode from localStorage on mount
  // Initialize to false to avoid hydration mismatch (server/client must match)
  const [mockMode, setMockModeState] = useState<boolean>(false);
  const [isClient, setIsClient] = useState(false);

  // Load from localStorage after client-side mount to avoid hydration mismatch
  useEffect(() => {
    setIsClient(true);
    const saved = localStorage.getItem('callbot_mock_mode');
    if (saved === 'true') {
      setMockModeState(true);
    }
  }, []);

  // Wrapper to sync mockMode to localStorage
  const setMockMode = (value: boolean | ((prev: boolean) => boolean)) => {
    setMockModeState((prev) => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      if (typeof window !== 'undefined') {
        localStorage.setItem('callbot_mock_mode', String(newValue));
      }
      return newValue;
    });
  };

  const API_BASE = getApiBaseUrl();

  // Centralized fetch helper that automatically attaches auth token
  // This ensures Clerk is loaded and user is signed in before making API calls
  const apiFetch = async (url: string, options?: RequestInit, timeoutMs = 8000) => {
    // Wait for Clerk to load
    if (!isLoaded) {
      console.warn("[API] Clerk not loaded yet, waiting...");
      throw new Error("Clerk not loaded");
    }

    // Check if user is signed in
    if (!isSignedIn) {
      console.warn("[API] User not signed in");
      setAuthStatus('required');
      throw new Error("Authentication required: Please sign in");
    }

    try {
      // Get token immediately before fetch
      const token = await getToken();
      if (!token) {
        console.error("[API] getToken() returned null - user may not be authenticated");
        setAuthStatus('required');
        throw new Error("Authentication required: No token available");
      }
      
      console.log("[API] Token obtained, making authenticated request to:", url);
      // Use the centralized authenticatedFetch from utils/api.ts
      return await authenticatedFetch(url, options, token, timeoutMs);
    } catch (err: any) {
      console.error("[API] Request failed:", err?.message || err);
      
      // Set auth status on 401
      if (err?.message?.includes('401') || err?.message?.includes('Authentication required')) {
        setAuthStatus('required');
      }
      
      throw err;
    }
  };

  // Handle incoming SSE events
  const handleLiveEvent = React.useCallback((event: SSEEvent) => {
    if (mockMode) return; // Ignore events in mock mode

    switch (event.type) {
      case 'CALL_STARTED':
        // Update contact's lastCallAt
        setContacts((prev) =>
          prev.map((cc) =>
            cc.id === event.campaignContactId
              ? {
                  ...cc,
                  lastCallAt: event.data.lastCallAt || new Date().toISOString(),
                }
              : cc
          )
        );
        break;

      case 'CALL_ENDED':
        // Update contact status and lastCallAt
        if (event.data.status) {
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId
                ? {
                    ...cc,
                    status: event.data.status!,
                    lastCallAt: event.data.lastCallAt || cc.lastCallAt,
                  }
                : cc
            )
          );
        }
        break;

      case 'LEAD_UPDATED':
        // Update contact status
        if (event.data.status) {
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId
                ? {
                    ...cc,
                    status: event.data.status!,
                  }
                : cc
            )
          );
        }
        break;

      case 'CALL_OUTCOME_PREDICTED':
        // Update contact with outcome prediction
        if (event.campaignContactId && event.data.bucket && event.data.action && event.data.followUp && event.data.confidence) {
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId
                ? {
                    ...cc,
                    outcome: {
                      score: event.data.probabilityScore || 0,
                      bucket: event.data.bucket!,
                      action: event.data.action!,
                      followUp: event.data.followUp!,
                      confidence: event.data.confidence!,
                    },
                  }
                : cc
            )
          );
        }
        break;

      case 'CALL_CONTEXT_UPDATED':
        // Update contact with emotion, urgency, and optionally script mode context
        if (event.campaignContactId && event.data.emotion && event.data.urgencyLevel) {
          // Map 'anxious' back to 'hesitant' for frontend display consistency
          const mappedEmotion = event.data.emotion === 'anxious' ? 'hesitant' : event.data.emotion;
          
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId
                ? {
                    ...cc,
                    context: {
                      emotion: mappedEmotion as 'calm' | 'excited' | 'frustrated' | 'hesitant',
                      urgencyLevel: event.data.urgencyLevel!,
                      scriptMode: (event.data.scriptMode || (cc.context?.scriptMode) || 'DISCOVERY') as 'INTRO' | 'DISCOVERY' | 'QUALIFICATION' | 'CLOSING' | 'FOLLOW_UP' | 'OBJECTION' | 'PITCH' | 'OBJECTION_HANDLING',
                    },
                  }
                : cc
            )
          );
          
          // Also update selectedLead if it matches
          if (selectedLead && selectedLead.id === event.campaignContactId) {
            setSelectedLead((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                context: {
                  emotion: mappedEmotion as 'calm' | 'excited' | 'frustrated' | 'hesitant',
                  urgencyLevel: event.data.urgencyLevel!,
                  scriptMode: (event.data.scriptMode || prev.context?.scriptMode || 'DISCOVERY') as 'INTRO' | 'DISCOVERY' | 'QUALIFICATION' | 'CLOSING' | 'FOLLOW_UP' | 'OBJECTION' | 'PITCH' | 'OBJECTION_HANDLING',
                },
              };
            });
          }
        }
        break;

      case 'VOICE_STRATEGY_UPDATED':
        // Update contact with voice strategy parameters
        if (event.campaignContactId && event.data.voiceTone && event.data.speechRate && event.data.scriptVariant) {
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId
                ? {
                    ...cc,
                    voiceStrategy: {
                      voiceTone: event.data.voiceTone!,
                      speechRate: event.data.speechRate!,
                      scriptVariant: event.data.scriptVariant!,
                      language: event.data.language || (cc.voiceStrategy?.language) || 'en',
                    },
                  }
                : cc
            )
          );
          
          // Also update selectedLead if it matches
          if (selectedLead && selectedLead.id === event.campaignContactId) {
            setSelectedLead((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                voiceStrategy: {
                  voiceTone: event.data.voiceTone!,
                  speechRate: event.data.speechRate!,
                  scriptVariant: event.data.scriptVariant!,
                  language: event.data.language || prev.voiceStrategy?.language || 'en',
                },
              };
            });
          }
        }
        break;

      case 'ADAPTIVE_STEP_UPDATED':
        // Update contact with adaptive conversation step
        if (event.campaignContactId && event.data.scriptMode && event.data.nextPromptInstruction) {
          // Map scriptMode to adaptive step type (ensure it's a valid adaptive script mode)
          const adaptiveScriptMode = (
            event.data.scriptMode === 'DISCOVERY' || 
            event.data.scriptMode === 'PITCH' || 
            event.data.scriptMode === 'OBJECTION_HANDLING' || 
            event.data.scriptMode === 'CLOSING'
          ) ? event.data.scriptMode as 'DISCOVERY' | 'PITCH' | 'OBJECTION_HANDLING' | 'CLOSING' : 'DISCOVERY';
          
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId
                ? {
                    ...cc,
                    adaptiveStep: {
                      scriptMode: adaptiveScriptMode,
                      nextPromptInstruction: event.data.nextPromptInstruction!,
                      slowDownSpeech: event.data.slowDownSpeech || false,
                      interruptAllowed: event.data.interruptAllowed || false,
                      confidenceBoost: event.data.confidenceBoost || false,
                    },
                  }
                : cc
            )
          );
          
          // Also update selectedLead if it matches
          if (selectedLead && selectedLead.id === event.campaignContactId) {
            setSelectedLead((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                adaptiveStep: {
                  scriptMode: adaptiveScriptMode,
                  nextPromptInstruction: event.data.nextPromptInstruction!,
                  slowDownSpeech: event.data.slowDownSpeech || false,
                  interruptAllowed: event.data.interruptAllowed || false,
                  confidenceBoost: event.data.confidenceBoost || false,
                },
              };
            });
          }
        }
        break;

      case 'LEARNING_STRATEGY_APPLIED':
        // Update contact with learning strategy recommendations
        if (event.campaignContactId && event.data.basedOn) {
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId
                ? {
                    ...cc,
                    learningStrategy: {
                      recommendedScriptMode: event.data.recommendedScriptMode,
                      recommendedVoiceTone: event.data.recommendedVoiceTone,
                      recommendedSpeechRate: event.data.recommendedSpeechRate,
                      basedOn: event.data.basedOn || 'historical_success',
                    },
                  }
                : cc
            )
          );
          
          // Also update selectedLead if it matches
          if (selectedLead && selectedLead.id === event.campaignContactId) {
            setSelectedLead((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                learningStrategy: {
                  recommendedScriptMode: event.data.recommendedScriptMode,
                  recommendedVoiceTone: event.data.recommendedVoiceTone,
                  recommendedSpeechRate: event.data.recommendedSpeechRate,
                  basedOn: event.data.basedOn || 'historical_success',
                },
              };
            });
          }
        }
        break;

      case 'HUMAN_OVERRIDE_APPLIED':
        // Update contact with human override information
        if (event.campaignContactId && event.data.overrides) {
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId
                ? {
                    ...cc,
                    humanOverride: event.data.overrides,
                  }
                : cc
            )
          );
          
          // Also update selectedLead if it matches
          if (selectedLead && selectedLead.id === event.campaignContactId) {
            setSelectedLead((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                humanOverride: event.data.overrides,
              };
            });
          }
        }
        break;

      case 'STRATEGY_AUTO_APPLIED':
        // STEP 21: Update contact with auto-applied strategy
        if (event.campaignContactId && event.data.strategySource === 'AUTO') {
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId
                ? {
                    ...cc,
                    autoAppliedStrategy: {
                      scriptVariant: event.data.scriptVariant,
                      voiceTone: event.data.voiceTone,
                      emotion: event.data.emotion,
                      urgencyLevel: event.data.urgencyLevel,
                      source: 'AUTO',
                      reason: event.data.reason || undefined,
                    },
                  }
                : cc
            )
          );
          
          // Also update selectedLead if it matches
          if (selectedLead && selectedLead.id === event.campaignContactId) {
            setSelectedLead((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                autoAppliedStrategy: {
                  scriptVariant: event.data.scriptVariant,
                  voiceTone: event.data.voiceTone,
                  emotion: event.data.emotion,
                  urgencyLevel: event.data.urgencyLevel,
                  source: 'AUTO',
                  reason: event.data.reason,
                },
              };
            });
          }
        }
        break;

      case 'CALL_LIVE_UPDATE':
        // STEP 23: Update live call monitoring data
        if (event.campaignContactId && event.data.callLogId) {
          // Map 'anxious' back to 'hesitant' for frontend display consistency
          const mappedEmotion = event.data.emotion === 'anxious' ? 'hesitant' : (event.data.emotion as 'calm' | 'excited' | 'frustrated' | 'hesitant' | undefined);
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId
                ? {
                    ...cc,
                    liveCall: {
                      callLogId: event.data.callLogId,
                      transcriptSummary: event.data.transcriptSummary,
                      emotion: mappedEmotion,
                      urgencyLevel: event.data.urgencyLevel,
                      objections: event.data.objections,
                      riskLevel: event.data.riskLevel,
                      suggestions: event.data.suggestions,
                      lastUpdateAt: event.data.lastUpdateAt,
                    },
                  }
                : cc
            )
          );
          
          // Also update selectedLead if it matches
          if (selectedLead && selectedLead.id === event.campaignContactId) {
            // Map 'anxious' back to 'hesitant' for frontend display consistency
            const mappedEmotionForLead = event.data.emotion === 'anxious' ? 'hesitant' : (event.data.emotion as 'calm' | 'excited' | 'frustrated' | 'hesitant' | undefined);
            setSelectedLead((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                liveCall: {
                  callLogId: event.data.callLogId,
                  transcriptSummary: event.data.transcriptSummary,
                  emotion: mappedEmotionForLead,
                  urgencyLevel: event.data.urgencyLevel,
                  objections: event.data.objections,
                  riskLevel: event.data.riskLevel,
                  suggestions: event.data.suggestions,
                  lastUpdateAt: event.data.lastUpdateAt,
                },
              };
            });
          }
        }
        break;

      case 'CALL_LIVE_RISK':
        // STEP 23: Handle elevated risk alerts
        if (event.campaignContactId && event.data.callLogId) {
          // Update live call with risk information
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId && cc.liveCall
                ? {
                    ...cc,
                    liveCall: {
                      ...cc.liveCall,
                      riskLevel: event.data.riskLevel,
                      recommendedAction: event.data.recommendedAction,
                    },
                  }
                : cc
            )
          );
          
          // Show alert for HIGH risk
          if (event.data.riskLevel === 'HIGH') {
            console.warn('[LiveCall] HIGH RISK detected:', event.data);
            // Could show browser notification here if needed
          }
        }
        break;

      case 'CALL_LIVE_SUGGESTION':
        // STEP 23: Handle whisper suggestions
        if (event.campaignContactId && event.data.callLogId && event.data.suggestions) {
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId && cc.liveCall
                ? {
                    ...cc,
                    liveCall: {
                      ...cc.liveCall,
                      suggestions: event.data.suggestions || [],
                    },
                  }
                : cc
            )
          );
        }
        break;

      case 'CALL_ENDED':
        // STEP 23: Clear live call data when call ends
        if (event.campaignContactId) {
          setContacts((prev) =>
            prev.map((cc) =>
              cc.id === event.campaignContactId
                ? {
                    ...cc,
                    liveCall: undefined,
                  }
                : cc
            )
          );
          
          if (selectedLead && selectedLead.id === event.campaignContactId) {
            setSelectedLead((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                liveCall: undefined,
              };
            });
          }
        }
        break;

      case 'CALL_SELF_REVIEW_READY':
        // STEP 24: Update contact with self-review data
        if (event.campaignContactId && event.data.selfReview && event.data.callLogId) {
          const callLogId = event.data.callLogId; // Ensure it's defined
          setContacts((prev) =>
            prev.map((cc) => {
              if (cc.id === event.campaignContactId) {
                // Update or add call to calls array
                const existingCalls = cc.calls || [];
                const callIndex = existingCalls.findIndex((c) => c.id === callLogId);
                
                if (callIndex >= 0) {
                  // Update existing call
                  const updatedCalls = [...existingCalls];
                  updatedCalls[callIndex] = {
                    ...updatedCalls[callIndex],
                    aiSelfReview: event.data.selfReview,
                  };
                  return { ...cc, calls: updatedCalls };
                } else {
                  // Add new call
                  return {
                    ...cc,
                    calls: [
                      ...existingCalls,
                      {
                        id: callLogId,
                        aiSelfReview: event.data.selfReview,
                      },
                    ],
                  };
                }
              }
              return cc;
            })
          );
          
          // Also update selectedLead if it matches
          if (selectedLead && selectedLead.id === event.campaignContactId) {
            const callLogId = event.data.callLogId; // Ensure it's defined
            setSelectedLead((prev) => {
              if (!prev) return prev;
              const existingCalls = prev.calls || [];
              const callIndex = existingCalls.findIndex((c) => c.id === callLogId);
              
              if (callIndex >= 0) {
                const updatedCalls = [...existingCalls];
                updatedCalls[callIndex] = {
                  ...updatedCalls[callIndex],
                  aiSelfReview: event.data.selfReview,
                };
                return { ...prev, calls: updatedCalls };
              } else {
                return {
                  ...prev,
                  calls: [
                    ...existingCalls,
                    {
                      id: callLogId,
                      aiSelfReview: event.data.selfReview,
                    },
                  ],
                };
              }
            });
          }
        }
        break;

      case 'LEAD_CREATED':
        // Add new lead to contacts list if it matches the selected campaign
        if (event.campaignContactId && event.campaignId === selectedCampaign?.id && event.data.name && event.data.phone) {
          // Check if lead already exists (avoid duplicates)
          setContacts((prev) => {
            const exists = prev.some((cc) => cc.id === event.campaignContactId);
            if (exists) {
              return prev;
            }
            
            // Add new lead to the list
            const newLead: CampaignContact = {
              id: event.campaignContactId!,
              campaignId: event.campaignId,
              contactId: event.contactId,
              status: 'NOT_PICK',
              contact: {
                id: event.contactId,
                name: event.data.name!,
                phone: event.data.phone!,
              },
            };
            
            return [...prev, newLead];
          });
        }
        break;

      case 'CAMPAIGN_CREATED':
        // Add new campaign to campaigns list if created elsewhere (multi-user safe)
        if (event.campaignId && event.data.name) {
          setCampaigns((prev) => {
            // Check if campaign already exists (avoid duplicates)
            const exists = prev.some((c) => c.id === event.campaignId);
            if (exists) {
              return prev;
            }
            
            // Add new campaign to the list
            const newCampaign: Campaign = {
              id: event.campaignId,
              name: event.data.name!,
              propertyId: event.data.propertyId || '',
            };
            
            return [newCampaign, ...prev]; // Add to top (most recent first)
          });
        }
        break;

      case 'BATCH_STARTED':
        // Initialize batch job state (clear previous batch if exists)
        if (event.data.batchJobId && event.data.totalLeads !== undefined) {
          setBatchJob({
            batchJobId: event.data.batchJobId,
            status: 'RUNNING',
            currentIndex: 0,
            totalLeads: event.data.totalLeads,
          });
          const timestamp = new Date().toLocaleTimeString();
          setBatchLogs([
            `[${timestamp}] Batch job started: ${event.data.totalLeads} leads to process`,
          ]);
        }
        break;

      case 'BATCH_PROGRESS':
        // Update batch progress
        if (event.data.batchJobId && event.data.currentIndex !== undefined && event.data.totalLeads !== undefined) {
          const currentIndex = event.data.currentIndex;
          const totalLeads = event.data.totalLeads;
          setBatchJob((prev) => {
            if (!prev || prev.batchJobId !== event.data.batchJobId) return prev;
            return {
              ...prev,
              currentIndex,
            };
          });
          const timestamp = new Date().toLocaleTimeString();
          const progressMsg = event.data.skipped
            ? `[${timestamp}] Lead ${currentIndex}/${totalLeads} skipped: ${event.data.reason || 'Unknown reason'}`
            : event.data.success
            ? `[${timestamp}] Lead ${currentIndex}/${totalLeads} called successfully`
            : `[${timestamp}] Lead ${currentIndex}/${totalLeads} call failed`;
          setBatchLogs((prev) => [progressMsg, ...prev]);
        }
        break;

      case 'BATCH_PAUSED':
        // Mark batch as paused
        if (event.data.batchJobId) {
          setBatchJob((prev) => {
            if (!prev || prev.batchJobId !== event.data.batchJobId) return prev;
            return {
              ...prev,
              status: 'PAUSED',
              pausedAt: new Date().toISOString(),
            };
          });
          const timestamp = new Date().toLocaleTimeString();
          const reason = event.data.reason || 'Unknown reason';
          setBatchLogs((prev) => [
            `[${timestamp}] Batch paused: ${reason}`,
            ...prev,
          ]);
        }
        break;

      case 'BATCH_RESUMED':
        // Mark batch as resumed
        if (event.data.batchJobId) {
          setBatchJob((prev) => {
            if (!prev || prev.batchJobId !== event.data.batchJobId) return prev;
            return {
              ...prev,
              status: 'RUNNING',
              pausedAt: null,
            };
          });
          const timestamp = new Date().toLocaleTimeString();
          setBatchLogs((prev) => [
            `[${timestamp}] Batch resumed: Continuing from lead ${event.data.currentIndex || 0}`,
            ...prev,
          ]);
        }
        break;

      case 'BATCH_COMPLETED':
        // Mark batch as completed
        if (event.data.batchJobId) {
          setBatchJob((prev) => {
            if (!prev || prev.batchJobId !== event.data.batchJobId) return prev;
            return {
              ...prev,
              status: 'COMPLETED',
            };
          });
          const timestamp = new Date().toLocaleTimeString();
          setBatchLogs((prev) => [
            `[${timestamp}] Batch completed: All ${event.data.totalLeads || prev[0]?.match(/\d+/)?.[0] || '0'} leads processed`,
            ...prev,
          ]);
        }
        break;

      case 'BATCH_CANCELLED':
        // Mark batch as cancelled
        if (event.data.batchJobId) {
          setBatchJob((prev) => {
            if (!prev || prev.batchJobId !== event.data.batchJobId) return prev;
            return {
              ...prev,
              status: 'CANCELLED',
            };
          });
          const timestamp = new Date().toLocaleTimeString();
          setBatchLogs((prev) => [
            `[${timestamp}] Batch cancelled: Human override or system stop`,
            ...prev,
          ]);
        }
        break;

      case 'BATCH_SKIPPED_OUTSIDE_TIME_WINDOW':
        // Handle skipped call due to time window
        if (event.data.batchJobId) {
          const timestamp = new Date().toLocaleTimeString();
          const nextRetryTime = event.data.nextRetryTime 
            ? new Date(event.data.nextRetryTime).toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })
            : 'Unknown';
          const retryCount = event.data.retryCount || 0;
          
          let logMessage = `[${timestamp}] Skipped — outside calling hours`;
          if (nextRetryTime !== 'Unknown') {
            logMessage += ` | Retry scheduled at ${nextRetryTime}`;
          }
          if (retryCount > 0) {
            logMessage += ` | Retry attempt ${retryCount}`;
          }
          
          setBatchLogs((prev) => [logMessage, ...prev]);
        }
        break;
    }
  }, [mockMode, selectedLead]);

  // Handle timeline events for the drawer
  const handleTimelineEvent = React.useCallback((event: LeadTimelineEvent) => {
    // Create a new object to trigger React re-render
    setLatestTimelineEvent({ ...event });
  }, []);

  // Handle lead status updates from drawer
  const handleLeadStatusUpdate = React.useCallback((status: LeadStatus) => {
    if (selectedLead) {
      // Update selected lead
      setSelectedLead((prev) => {
        if (!prev) return prev;
        return { ...prev, status };
      });
      
      // Also update in the contacts list
      setContacts((prev) =>
        prev.map((cc) =>
          cc.id === selectedLead.id ? { ...cc, status } : cc
        )
      );
    }
  }, [selectedLead]);

  // Set up live events
  const { isConnected: isLiveConnected, isReconnecting, error: sseError } = useLiveEvents({
    apiBase: API_BASE,
    onEvent: handleLiveEvent,
    onTimelineEvent: handleTimelineEvent,
    campaignContactId: drawerOpen && selectedLead ? selectedLead.id : null,
    mockMode: mockMode,
  });

  // Track previous backend status for logging
  const previousBackendStatusRef = useRef<'checking' | 'online' | 'offline'>('checking');

  // CRITICAL: Backend health check - ONLY /health response controls backendHealth
  // - Uses plain fetch (NO auth token, NO Clerk dependency)
  // - ONLY sets backendHealth based on /health response
  // - Auth errors (401) from other endpoints NEVER affect backendHealth
  // - Network errors/timeouts set backendHealth to 'offline'
  useEffect(() => {
    // Health check runs independently of mock mode, auth status, or Clerk loading
    // It only checks if the backend server is reachable

    const checkHealth = async () => {
      try {
        // Use plain fetch - NO auth token, NO Clerk dependency
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(`${API_BASE}/health`, {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // ONLY /health response.ok controls backendHealth
        // HTTP 200 from /health = Backend Online (unconditionally)
        if (response.ok) {
          const previousStatus = previousBackendStatusRef.current;
          if (previousStatus !== 'online') {
            console.log("[HEALTH] Backend is now ONLINE");
          }
          previousBackendStatusRef.current = 'online';
          setBackendHealth('online');
          
          // Disable mock mode when backend is online
          if (mockMode) {
            setMockMode(false);
            console.log("[HEALTH] Backend online, mock mode disabled");
          }
        } else {
          // Non-200 response - treat as offline
          const previousStatus = previousBackendStatusRef.current;
          if (previousStatus !== 'offline') {
            console.log("[HEALTH] Backend is now OFFLINE (non-200 response)");
          }
          previousBackendStatusRef.current = 'offline';
          setBackendHealth('offline');
        }
      } catch (err: any) {
        // Network error, timeout, or no response - backend is offline
        const errorMessage = err?.message || String(err);
        const isNetworkError = 
          err.name === 'AbortError' || 
          errorMessage.includes('timeout') ||
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('Network error') ||
          errorMessage.includes('network');

        if (isNetworkError) {
          const previousStatus = previousBackendStatusRef.current;
          if (previousStatus !== 'offline') {
            console.log("[HEALTH] Backend is now OFFLINE (network error)");
          }
          previousBackendStatusRef.current = 'offline';
          setBackendHealth('offline');
        } else {
          // Unexpected error - log but don't mark as offline
          console.error("[HEALTH] Unexpected error:", errorMessage);
        }
      }
    };

    // Check immediately
    checkHealth();

    // Check every 10 seconds
    const interval = setInterval(checkHealth, 10000);

    return () => clearInterval(interval);
  }, [API_BASE, mockMode]);

  // Auth gating: Redirect to sign-in if not signed in (after Clerk loads)
  useEffect(() => {
    if (!isLoaded) {
      // Wait for Clerk to load
      return;
    }

    if (!isSignedIn) {
      console.log("[AUTH] User not signed in, redirecting to /sign-in");
      setAuthStatus('required');
      setCampaigns([]);
      // Redirect to sign-in page
      router.push('/sign-in');
      return;
    }

    // User is signed in, proceed with normal flow
    setAuthStatus('authenticated');
  }, [isLoaded, isSignedIn, router]);

  // Fetch campaigns when Clerk is loaded and user is signed in
  useEffect(() => {
    if (!isLoaded) {
      console.log("[DIAGNOSTIC] Clerk not loaded yet, waiting...");
      return;
    }

    if (!isSignedIn) {
      // Don't fetch if not signed in (will redirect)
      return;
    }

    console.log("[DIAGNOSTIC] Clerk loaded and user signed in, calling fetchCampaigns");
    fetchCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  // Diagnostic: Log campaigns state changes
  useEffect(() => {
    console.log("[DIAGNOSTIC] campaigns state changed - Count:", campaigns.length);
    console.log("[DIAGNOSTIC] campaigns state changed - Data:", JSON.stringify(campaigns, null, 2));
  }, [campaigns]);

  // Auto-select first campaign if none is selected and campaigns are loaded
  useEffect(() => {
    if (campaigns.length > 0 && !selectedCampaign && !loading) {
      console.log("[DIAGNOSTIC] Auto-selecting first campaign:", campaigns[0]);
      openCampaign(campaigns[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns.length, selectedCampaign, loading]);

  async function fetchCampaigns() {
    console.log("[DIAGNOSTIC] fetchCampaigns - Starting...");
    console.log("[DIAGNOSTIC] fetchCampaigns - API_BASE:", API_BASE);
    console.log("[DIAGNOSTIC] fetchCampaigns - mockMode:", mockMode);
    setLoading(true);
    try {
      if (mockMode) {
        console.log("[DIAGNOSTIC] fetchCampaigns - Using mock mode, skipping API call");
        setCampaigns([
          { id: "mock-c1", name: "Mock Campaign 1", propertyId: "mock-p1", totalLeads: 15, warmLeadsCount: 5, hotLeadsCount: 2 },
          { id: "mock-c2", name: "Mock Campaign 2", propertyId: "mock-p2", totalLeads: 8, warmLeadsCount: 3, hotLeadsCount: 1 },
        ]);
        return;
      }
      console.log("[FETCH] Calling GET /api/campaigns with auth token");
      const data: any = await apiFetch(`${API_BASE}/api/campaigns`);
      console.log("[FETCH] Response received:", JSON.stringify(data, null, 2));
      
      // Backend returns { campaigns: [...] }, so extract campaigns array
      const list = Array.isArray(data) ? data : (data?.campaigns || []);
      console.log("[FETCH] Parsed campaigns list, length:", list.length);
      
      // Disable mock mode immediately on successful backend response (even if empty array)
      // A successful response means backend is reachable and auth worked
      setMockMode(false);
      console.log("[FETCH] Backend responded successfully, mock mode disabled");
      
      // Update auth status on success
      setAuthStatus('authenticated');
      
      // Handle empty results gracefully (user not logged in or no campaigns)
      setCampaigns(list);
      console.log("[DIAGNOSTIC] fetchCampaigns - State set, campaigns count:", list.length);
      
      // Auto-select first campaign if none is selected and campaigns exist
      if (list.length > 0 && !selectedCampaign) {
        console.log("[DIAGNOSTIC] fetchCampaigns - Auto-selecting first campaign:", list[0]);
        // Use setTimeout to ensure state update completes first
        setTimeout(() => {
          openCampaign(list[0]);
        }, 0);
      }
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      console.error("[FETCH] Error fetching campaigns:", errorMessage);
      console.error("[FETCH] Error details:", {
        message: err?.message,
        stack: err?.stack,
        name: err?.name,
      });
      
      // CRITICAL: 401 errors NEVER mark backend offline, NEVER enable mock mode
      // Backend health is ONLY controlled by /health endpoint response
      if (errorMessage.includes('401') || errorMessage.includes('Authentication required')) {
        console.error("[FETCH] 401 Unauthorized - Authentication required");
        setAuthStatus('required');
        setToast("Authentication required. Please sign in.");
        setCampaigns([]);
        // DO NOT set backendHealth - it's controlled ONLY by /health endpoint
        // DO NOT activate mock mode on 401 - auth errors are separate from network errors
      } else if (errorMessage.includes('Network error') || errorMessage.includes('timeout') || errorMessage.includes('Failed to fetch')) {
        // Only activate mock mode on actual network/connection errors
        console.warn("[FETCH] Network error - Backend unreachable, activating mock mode");
        setToast("Backend unreachable — switching to Mock Mode. Check connection and retry.");
        setMockMode(true);
        setCampaigns([
          { id: "mock-c1", name: "Mock Campaign 1", propertyId: "mock-p1" },
        ]);
      } else {
        setToast(`Error: ${errorMessage}`);
        setCampaigns([]);
      }
    } finally {
      setLoading(false);
      console.log("[DIAGNOSTIC] fetchCampaigns - Complete, loading set to false");
    }
  }

  async function openCampaign(c: Campaign) {
    setSelectedCampaign(c);
    setLoading(true);
    try {
      if (mockMode) {
        setContacts([
          {
            id: "mock-cc-1",
            campaignId: c.id,
            contactId: "mock-contact-1",
            status: "NOT_PICK",
            lastCallAt: null,
            contact: { id: "mock-contact-1", name: "Ramesh", phone: "+919000000001" },
          },
        ]);
        return;
      }
      const data: any = await apiFetch(`${API_BASE}/api/campaigns/${c.id}/contacts`);
      const list = Array.isArray(data) ? data : data?.contacts || [];
      setContacts(list);
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      console.error("openCampaign error:", errorMessage);
      
      // Separate auth errors from network errors
      if (errorMessage.includes('401') || errorMessage.includes('Authentication required')) {
        setAuthStatus('required');
        setToast("Authentication required. Please sign in.");
        setContacts([]);
        // DO NOT enable mock mode on auth errors
      } else if (errorMessage.includes('Network error') || errorMessage.includes('timeout') || errorMessage.includes('Failed to fetch')) {
        // Only enable mock mode on network errors
        setToast("Backend unreachable — switching to Mock Mode.");
        setContacts([]);
        setMockMode(true);
      } else {
        setToast(`Failed to load contacts: ${errorMessage}`);
        setContacts([]);
      }
    } finally {
      setLoading(false);
    }
  }

  async function startCall(campaignContactId: string) {
    // Explicitly prevent real calls in Mock Mode
    if (mockMode) {
      setToast("(Mock) Call started — simulated ringing");
      setContacts((prev) =>
        prev.map((p) => (p.id === campaignContactId ? { ...p, lastCallAt: new Date().toISOString() } : p))
      );
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/call/start/${campaignContactId}`, { method: "POST" });
      setToast((res && (res as any).message) || "Call started — ringing the contact");
      if (selectedCampaign) openCampaign(selectedCampaign);
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      console.error("startCall error:", errorMessage);
      
      // Separate auth errors from network errors
      if (errorMessage.includes('401') || errorMessage.includes('Authentication required')) {
        setAuthStatus('required');
        setToast("Authentication required. Please sign in.");
        // DO NOT enable mock mode on auth errors
      } else if (errorMessage.includes('Network error') || errorMessage.includes('timeout') || errorMessage.includes('Failed to fetch')) {
        // Only enable mock mode on network errors
        setToast("Backend unreachable — switching to Mock Mode.");
        setMockMode(true);
      } else {
        setToast(`Failed to start call: ${errorMessage}`);
      }
    } finally {
      setLoading(false);
    }
  }

  // Check if there are eligible leads for batch calling
  const hasEligibleLeads = React.useMemo(() => {
    if (!selectedCampaign) return false;
    // Eligible: NOT_PICK, COLD, WARM (excluding HOT)
    return contacts.some(cc => 
      cc.status === 'NOT_PICK' || cc.status === 'COLD' || cc.status === 'WARM'
    );
  }, [contacts, selectedCampaign]);

  // Sticky CTA visibility and animation state
  const showStickyCTA = selectedCampaign && hasEligibleLeads && (!batchJob || batchJob.status !== 'RUNNING');
  const [stickyCTAAnimating, setStickyCTAAnimating] = useState(false);

  // Toggle low-interest leads visibility
  const toggleLowInterestLeads = () => {
    const newValue = !showLowInterestLeads;
    setShowLowInterestLeads(newValue);
    if (typeof window !== 'undefined') {
      localStorage.setItem('callbot_show_low_interest', String(newValue));
    }
  };

  // Smart auto-sort: HOT → WARM → NOT_PICK, filter COLD by default
  const sortedAndFilteredContacts = React.useMemo(() => {
    let filtered = contacts;
    
    // Filter out COLD leads if toggle is off
    if (!showLowInterestLeads) {
      filtered = filtered.filter(cc => cc.status !== 'COLD');
    }

    // Sort: HOT → WARM → NOT_PICK → COLD (if shown)
    return filtered.sort((a, b) => {
      const statusOrder: Record<string, number> = {
        'HOT': 1,
        'WARM': 2,
        'NOT_PICK': 3,
        'COLD': 4,
      };
      const aOrder = statusOrder[a.status || ''] || 99;
      const bOrder = statusOrder[b.status || ''] || 99;
      return aOrder - bOrder;
    });
  }, [contacts, showLowInterestLeads]);

  useEffect(() => {
    if (showStickyCTA) {
      // Trigger animation after mount
      requestAnimationFrame(() => {
        setStickyCTAAnimating(true);
      });
    } else {
      setStickyCTAAnimating(false);
    }
  }, [showStickyCTA]);

  // Start batch call function
  async function startBatchCall() {
    if (!selectedCampaign) {
      setToast('Please select a campaign first');
      return;
    }

    if (batchJob && (batchJob.status === 'RUNNING' || batchJob.status === 'PAUSED')) {
      setToast('A batch is already running. Please pause or stop it first.');
      return;
    }

    if (!hasEligibleLeads) {
      setToast('No eligible leads found. Eligible leads must have status NOT_PICK, COLD, or WARM.');
      return;
    }

    setIsStartingBatch(true);
    setCsvUploadSuccessBanner(null); // Hide CSV success banner when starting batch
    try {
      if (mockMode) {
        setToast('(Mock) Batch call started');
        setBatchJob({
          batchJobId: 'mock-batch-' + Date.now(),
          status: 'RUNNING',
          currentIndex: 0,
          totalLeads: contacts.filter(cc => 
            cc.status === 'NOT_PICK' || cc.status === 'COLD' || cc.status === 'WARM'
          ).length,
        });
        setIsStartingBatch(false);
        return;
      }

      const res = await apiFetch(`${API_BASE}/batch/start/${selectedCampaign.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cooldownHours: 24,
          maxRetries: 2,
        }),
      });

      const data = res as any;
      if (data.ok) {
        setToast('AI calling started. Leads will be auto-sorted.');
        setBatchJob({
          batchJobId: data.batchJobId,
          status: 'RUNNING',
          currentIndex: 0,
          totalLeads: data.totalLeads,
        });
        // Refresh contacts to see updated statuses
        if (selectedCampaign) {
          openCampaign(selectedCampaign);
        }
      } else {
        setToast(data.error || data.message || 'Failed to start batch call');
      }
    } catch (err: any) {
      console.error('startBatchCall error:', err?.message || err);
      setToast('Failed to start batch call. See console for details.');
    } finally {
      setIsStartingBatch(false);
    }
  }

  function openApplyScoreModal(callLogId?: string) {
    setActiveCallLogId(callLogId || null);
    setTranscript("");
    setDurationSeconds(90);
    setShowScoreModal(true);
  }

  function openLeadDrawer(campaignContact: CampaignContact, event?: React.MouseEvent) {
    // Store the element that triggered the drawer (for focus restoration)
    if (event?.currentTarget instanceof HTMLElement) {
      previousFocusElementRef.current = event.currentTarget;
    } else if (document.activeElement instanceof HTMLElement) {
      previousFocusElementRef.current = document.activeElement;
    }
    
    setSelectedLead(campaignContact);
    setDrawerOpen(true);
  }

  function closeLeadDrawer() {
    setDrawerOpen(false);
    setSelectedLead(null);
  }

  function handleStatusChange(newStatus: LeadStatus) {
    if (!selectedLead) return;

    if (mockMode) {
      setContacts((prev) =>
        prev.map((cc) =>
          cc.id === selectedLead.id ? { ...cc, status: newStatus } : cc
        )
      );
      setSelectedLead({ ...selectedLead, status: newStatus });
      setToast(`(Mock) Status changed to ${newStatus}`);
      return;
    }

    // In real mode, you could call an API endpoint here
    // For now, update locally
    setContacts((prev) =>
      prev.map((cc) =>
        cc.id === selectedLead.id ? { ...cc, status: newStatus } : cc
      )
    );
    setSelectedLead({ ...selectedLead, status: newStatus });
    setToast(`Status changed to ${newStatus}`);
  }

  function handleDrawerStartCall() {
    if (selectedLead) {
      closeLeadDrawer();
      startCall(selectedLead.id);
    }
  }

  async function applyScore() {
    if (!activeCallLogId) {
      setToast("Please provide a callLogId first (use a call you started)");
      return;
    }

    // Explicitly prevent real API calls in Mock Mode
    if (mockMode) {
      setToast("(Mock) Status set: HOT");
      setContacts((prev) =>
        prev.map((cc) =>
          cc.id === activeCallLogId ? { ...cc, status: "HOT" as const } : cc
        )
      );
      setShowScoreModal(false);
      return;
    }

    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/debug/apply-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callLogId: activeCallLogId, transcript, durationSeconds }),
      });
      const status = (res && (res as any).status) || "OK";
      setToast(`Status set: ${status}`);
      setShowScoreModal(false);
      if (selectedCampaign) openCampaign(selectedCampaign);
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      console.error("applyScore error:", errorMessage);
      
      // Separate auth errors from network errors
      if (errorMessage.includes('401') || errorMessage.includes('Authentication required')) {
        setAuthStatus('required');
        setToast("Authentication required. Please sign in.");
        // DO NOT enable mock mode on auth errors
      } else if (errorMessage.includes('Network error') || errorMessage.includes('timeout') || errorMessage.includes('Failed to fetch')) {
        // Only enable mock mode on network errors
        setToast("Backend unreachable — switching to Mock Mode.");
        setMockMode(true);
      } else {
        setToast(`Failed to apply score: ${errorMessage}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sticky Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Tablet & Mobile Hamburger Menu */}
              <button
                onClick={() => setCampaignDrawerOpen(true)}
                className="lg:hidden p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                aria-label="Open campaigns menu"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <h1 className="text-lg sm:text-xl font-semibold text-gray-900">CallBot</h1>
            {isLiveConnected && !mockMode && (
              <div className="flex items-center gap-2 px-2 py-1 bg-green-100 text-green-700 rounded-md text-xs font-medium">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                Live
              </div>
            )}
            {mockMode && (
              <div 
                className="flex items-center gap-2 px-2 py-1 bg-amber-100 text-amber-700 rounded-md text-xs font-medium cursor-help relative group"
                title="Mock Mode: Using simulated data. No real API calls or phone calls will be made."
              >
                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                Mock Data
                <div className="absolute bottom-full left-0 mb-2 w-64 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <strong>Mock Mode Enabled:</strong><br />
                  • Using simulated data only<br />
                  • No real API calls will be made<br />
                  • No phone calls will be initiated<br />
                  • Useful for testing UI without backend
                  <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                </div>
              </div>
            )}
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden sm:flex items-center gap-2 relative group">
              <label htmlFor="mock-mode-toggle" className="text-sm cursor-pointer">
                Mock Mode
              </label>
              <input 
                id="mock-mode-toggle"
                type="checkbox" 
                checked={mockMode} 
                onChange={(e) => {
                  const newValue = e.target.checked;
                  setMockMode(newValue);
                  // Refresh data when toggling
                  if (newValue) {
                    fetchCampaigns();
                  } else if (selectedCampaign) {
                    openCampaign(selectedCampaign);
                  } else {
                    fetchCampaigns();
                  }
                }}
                className="cursor-pointer"
              />
              <div className="absolute bottom-full right-0 mb-2 w-56 p-2 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                Toggle Mock Mode to use simulated data instead of real API calls. State is saved in your browser.
                <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
              </div>
              </div>
              <button 
                className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors" 
                onClick={() => fetchCampaigns()}
              >
                <span className="hidden sm:inline">Refresh</span>
                <span className="sm:hidden">↻</span>
              </button>
              {isLoaded && isSignedIn && (
                <UserButton afterSignOutUrl="/sign-in" />
              )}
            </div>
          </div>
        </div>
        
        {/* System Status Bar */}
        <div className="px-4 sm:px-6 py-2 bg-slate-50 border-t border-gray-100">
          <div className="flex items-center gap-2 sm:gap-4 text-xs overflow-x-auto">
            <div className="flex items-center gap-2">
              <span className="text-gray-600 font-medium">Status:</span>
              {/* Auth Status */}
              {isLoaded && !isSignedIn ? (
                <div className="flex items-center gap-2">
                  <span className="text-red-600 font-medium text-xs">Authentication required</span>
                  <SignInButton mode="modal">
                    <button className="px-3 py-1 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors">
                      Sign In
                    </button>
                  </SignInButton>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${
                    authStatus === 'authenticated' ? 'bg-green-500' :
                    authStatus === 'required' ? 'bg-red-500' :
                    'bg-yellow-500 animate-pulse'
                  }`}></span>
                  <span className="text-gray-700">
                    Auth {authStatus === 'authenticated' ? 'OK' : authStatus === 'required' ? 'Required' : 'Checking...'}
                  </span>
                </div>
              )}
              {/* Backend Health */}
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  backendHealth === 'online' ? 'bg-green-500' :
                  backendHealth === 'offline' ? 'bg-red-500' :
                  'bg-yellow-500 animate-pulse'
                }`}></span>
                <span className="text-gray-700">
                  Backend {backendHealth === 'online' ? 'Online' : backendHealth === 'offline' ? 'Offline' : 'Checking...'}
                </span>
              </div>
              
              {/* SSE Connection */}
              {!mockMode && (
                <>
                  <span className="text-gray-400">•</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${
                      isLiveConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                    }`}></span>
                    <span className="text-gray-700">
                      SSE {isLiveConnected ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                </>
              )}
              
              {/* Current Mode */}
              <span className="text-gray-400">•</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${
                  mockMode ? 'bg-amber-500' : 'bg-blue-500'
                }`}></span>
                <span className="text-gray-700 font-medium">
                  {mockMode ? 'Mock Mode' : 'Live Mode'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Auth Required Banner - Show when auth is required, regardless of backend status */}
      {isLoaded && authStatus === 'required' && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 sm:px-6 py-3">
          <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-blue-700 font-medium text-sm">Sign in to load campaigns</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/sign-in')}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
              >
                Go to Sign In
              </button>
              <SignInButton mode="modal">
                <button className="px-4 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-300 rounded-md hover:bg-blue-50 transition-colors">
                  Sign In (Modal)
                </button>
              </SignInButton>
            </div>
          </div>
        </div>
      )}

      {/* Backend Offline Banner */}
      {backendHealth === 'offline' && (
        <div className="bg-red-50 border-b border-red-200 px-4 sm:px-6 py-3">
          <div className="max-w-[1440px] mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-red-700 font-medium text-sm">Backend is offline. Mock Mode is enabled.</span>
            </div>
          </div>
        </div>
      )}

      {/* STEP 21: Full-width responsive layout */}
      <div className="w-full flex relative">
          {/* Tablet & Mobile: Campaign Drawer (Slide-in) */}
          {campaignDrawerShouldRender && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 bg-black z-40 lg:hidden"
                style={{
                  opacity: campaignDrawerAnimating ? 0.4 : 0,
                  transition: prefersReducedMotion 
                    ? 'none' 
                    : 'opacity 250ms cubic-bezier(0.16, 1, 0.3, 1)'
                }}
                onClick={() => setCampaignDrawerOpen(false)}
                aria-hidden="true"
                tabIndex={-1}
              />
              {/* Drawer - Tablet & Mobile: Slide-in from left */}
              <aside 
                ref={drawerRef}
                className={`fixed left-0 top-0 h-full w-72 max-w-[85vw] bg-white z-50 shadow-xl overflow-y-auto ${
                  campaignDrawerAnimating ? 'translate-x-0' : '-translate-x-full'
                }`}
                style={{
                  transition: prefersReducedMotion 
                    ? 'none' 
                    : 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="campaign-drawer-title"
              >
                <div className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 id="campaign-drawer-title" className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Campaigns</h2>
                    <button
                      onClick={() => setCampaignDrawerOpen(false)}
                      className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                      aria-label="Close menu"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setShowNewCampaignModal(true);
                      setCampaignDrawerOpen(false);
                    }}
                    className="w-full mb-4 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
                  >
                    + New Campaign
                  </button>
                  {loading && <div className="text-sm text-gray-500 py-4">Loading...</div>}
                  <div className="space-y-2">
                    {campaigns.length === 0 && (
                      <div className="text-sm text-gray-500 py-4 text-center">No campaigns yet</div>
                    )}
                    {[...campaigns]
                      .sort((a, b) => {
                        const aHot = a.hotLeadsCount ?? 0;
                        const bHot = b.hotLeadsCount ?? 0;
                        const aWarm = a.warmLeadsCount ?? 0;
                        const bWarm = b.warmLeadsCount ?? 0;
                        const aTotal = a.totalLeads ?? 0;
                        const bTotal = b.totalLeads ?? 0;
                        
                        if (aHot !== bHot) return bHot - aHot;
                        if (aWarm !== bWarm) return bWarm - aWarm;
                        return bTotal - aTotal;
                      })
                      .map((c) => {
                        const isSelected = selectedCampaign?.id === c.id;
                        const totalLeads = c.totalLeads ?? 0;
                        const warmCount = c.warmLeadsCount ?? 0;
                        const hotCount = c.hotLeadsCount ?? 0;
                        
                        return (
                          <button
                            key={c.id}
                            className={`w-full text-left p-2.5 rounded-lg transition-all ${
                              isSelected
                                ? 'bg-blue-50 border-l-4 border-blue-600 shadow-sm'
                                : 'hover:bg-gray-50 border-l-4 border-transparent'
                            }`}
                            onClick={() => {
                              openCampaign(c);
                              setCampaignDrawerOpen(false);
                            }}
                          >
                            <div className="text-sm font-semibold text-gray-900 mb-1">{c.name}</div>
                            <div className="text-xs text-gray-600 flex items-center gap-1.5 flex-wrap">
                              {hotCount > 0 && <span className="text-red-600 font-medium">🔥 {hotCount}</span>}
                              {hotCount > 0 && (warmCount > 0 || totalLeads - hotCount - warmCount > 0) && <span className="text-gray-300">•</span>}
                              {warmCount > 0 && <span className="text-amber-600">🟡 {warmCount}</span>}
                              {warmCount > 0 && totalLeads - hotCount - warmCount > 0 && <span className="text-gray-300">•</span>}
                              {totalLeads - hotCount - warmCount > 0 && (
                                <span className="text-gray-500">New {totalLeads - hotCount - warmCount}</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              </aside>
            </>
          )}

          {/* Desktop: Campaigns Sidebar (Fixed, always visible on >=1024px) */}
          <aside className="hidden lg:block w-[280px] flex-shrink-0 sticky top-[120px] h-[calc(100vh-120px)] overflow-y-auto border-r border-gray-200 bg-white">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Campaigns</h2>
                <button
                  onClick={() => setShowNewCampaignModal(true)}
                  className="px-2.5 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors"
                  title="Create a new campaign"
                >
                  + New
                </button>
              </div>
              {loading && <div className="text-sm text-gray-500 py-4">Loading...</div>}
              <div className="space-y-2">
                {campaigns.length === 0 && (
                  <div className="text-sm text-gray-500 py-4 text-center">No campaigns yet</div>
                )}
                {[...campaigns]
                  .sort((a, b) => {
                    const aHot = a.hotLeadsCount ?? 0;
                    const bHot = b.hotLeadsCount ?? 0;
                    const aWarm = a.warmLeadsCount ?? 0;
                    const bWarm = b.warmLeadsCount ?? 0;
                    const aTotal = a.totalLeads ?? 0;
                    const bTotal = b.totalLeads ?? 0;
                    
                    // Sort by HOT (desc), then WARM (desc), then total (desc)
                    if (aHot !== bHot) return bHot - aHot;
                    if (aWarm !== bWarm) return bWarm - aWarm;
                    return bTotal - aTotal;
                  })
                  .map((c) => {
                    const isSelected = selectedCampaign?.id === c.id;
                    // Use backend-provided counts, fallback to 0 if missing
                    const totalLeads = c.totalLeads ?? 0;
                    const warmCount = c.warmLeadsCount ?? 0;
                    const hotCount = c.hotLeadsCount ?? 0;
                    
                    return (
                      <button
                        key={c.id}
                        className={`w-full text-left p-2.5 rounded-lg transition-all ${
                          isSelected
                            ? 'bg-blue-50 border-l-4 border-blue-600 shadow-sm'
                            : 'hover:bg-gray-50 border-l-4 border-transparent'
                        }`}
                        onClick={() => openCampaign(c)}
                      >
                        {/* Campaign name and counts in single compact block */}
                        <div className="text-sm font-semibold text-gray-900 mb-1">{c.name}</div>
                        <div className="text-xs text-gray-600 flex items-center gap-1.5 flex-wrap">
                          {hotCount > 0 && <span className="text-red-600 font-medium">🔥 {hotCount}</span>}
                          {hotCount > 0 && (warmCount > 0 || totalLeads - hotCount - warmCount > 0) && <span className="text-gray-300">•</span>}
                          {warmCount > 0 && <span className="text-amber-600">🟡 {warmCount}</span>}
                          {warmCount > 0 && totalLeads - hotCount - warmCount > 0 && <span className="text-gray-300">•</span>}
                          {totalLeads - hotCount - warmCount > 0 && (
                            <span className="text-gray-500">New {totalLeads - hotCount - warmCount}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          </aside>

          {/* Center: Main Content - Contacts/Leads */}
          <main className="flex-1 min-w-0 bg-white">
            {/* Scrollable Content Container */}
            <div className="h-[calc(100vh-120px)] overflow-y-auto">
              {/* Sticky Action Bar */}
              <div className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900">
                    {selectedCampaign ? selectedCampaign.name : 'Select a Campaign'}
                  </h2>
                  {selectedCampaign && (
                    <>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {contacts.length} {contacts.length === 1 ? 'lead' : 'leads'}
                      </p>
                    </>
                  )}
                </div>
                {selectedCampaign && (
                  <div className="hidden md:flex gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        if (typeof window !== 'undefined') {
                          window.location.href = `/analytics?campaignId=${selectedCampaign.id}`;
                        }
                      }}
                      className="px-2 sm:px-3 py-1.5 bg-purple-600 text-white text-xs sm:text-sm font-medium rounded-md hover:bg-purple-700 transition-colors"
                      title="View analytics for this campaign"
                    >
                      <span className="hidden sm:inline">📊 Analytics</span>
                      <span className="sm:hidden">📊</span>
                    </button>
                    <button
                      onClick={() => setShowCsvUploadModal(true)}
                      className="px-2 sm:px-3 py-1.5 bg-green-600 text-white text-xs sm:text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      disabled={isUploadingCsv}
                    >
                      <span className="hidden sm:inline">📄 Upload CSV</span>
                      <span className="sm:hidden">📄</span>
                    </button>
                    <button
                      onClick={() => setShowAddLeadModal(true)}
                      className="px-2 sm:px-3 py-1.5 bg-blue-600 text-white text-xs sm:text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      disabled={isUploadingCsv}
                    >
                      <span className="hidden sm:inline">+ Add Lead</span>
                      <span className="sm:hidden">+</span>
                    </button>
                    {/* Start AI Calling Button - Primary */}
                    {selectedCampaign && (selectedCampaign.totalLeads ?? 0) > 0 && (!batchJob || batchJob.status !== 'RUNNING') && (
                      <button
                        onClick={startBatchCall}
                        disabled={isStartingBatch}
                        className="px-2 sm:px-3 py-1.5 bg-emerald-600 text-white text-xs sm:text-sm font-semibold rounded-md hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors relative group"
                        title="Start AI calling for all eligible leads"
                      >
                        {isStartingBatch ? (
                          <>
                            <svg className="inline-block animate-spin h-3 w-3 sm:h-4 sm:w-4 mr-1" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span className="hidden sm:inline">Starting...</span>
                            <span className="sm:hidden">...</span>
                          </>
                        ) : (
                          <>
                            <span className="hidden sm:inline">🤖 Start AI Calling</span>
                            <span className="sm:hidden">🤖</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Batch Activity Log Panel - Keep this for detailed logs */}

            {/* Batch Activity Log Panel - Moved to sticky action bar area */}
            {batchJob && batchLogs.length > 0 && (
              <div className="sticky top-[200px] z-10 bg-white border-b border-gray-200 px-4 sm:px-6 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Batch Activity</h3>
                </div>
                <div className="max-h-[120px] overflow-y-auto">
                  {batchLogs.slice(0, 5).map((log, idx) => {
                    // Determine dot color based on log content
                    const logLower = log.toLowerCase();
                    let dotColor = 'bg-gray-400'; // default
                    if (logLower.includes('started')) {
                      dotColor = 'bg-blue-500';
                    } else if (logLower.includes('completed')) {
                      dotColor = 'bg-green-500';
                    } else if (logLower.includes('paused')) {
                      dotColor = 'bg-yellow-500';
                    } else if (logLower.includes('failed') || logLower.includes('cancelled')) {
                      dotColor = 'bg-red-500';
                    }
                    
                    return (
                      <div
                        key={idx}
                        className="px-2 py-1.5 flex items-start gap-2 text-xs"
                      >
                        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`}></div>
                        <div className="text-xs text-gray-600 flex-1">{log}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Scrollable Content Area */}
            <div className={`overflow-y-auto h-[calc(100vh-240px)] px-6 py-4 ${
              // Add bottom padding on desktop when sticky CTA is visible
              selectedCampaign && hasEligibleLeads && (!batchJob || batchJob.status !== 'RUNNING')
                ? 'lg:pb-24'
                : ''
            }`}>
              {selectedCampaign ? (
                <div>

                  {/* Empty State for New Campaign */}
                  {contacts.length === 0 && !csvUploadSuccessBanner && (
                    <div className="text-center py-16">
                      <div className="max-w-md mx-auto">
                        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <h3 className="mt-4 text-sm font-semibold text-gray-900">No leads yet</h3>
                        <p className="mt-2 text-sm text-gray-500">
                          Add your first lead to start calling.
                        </p>
                        <div className="mt-6 flex gap-3 justify-center">
                          <button
                            onClick={() => setShowAddLeadModal(true)}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                          >
                            ➕ Add Lead
                          </button>
                          <button
                            disabled={isUploadingCsv}
                            className="px-4 py-2 bg-gray-100 text-gray-500 text-sm font-medium rounded-md cursor-not-allowed"
                            title={isUploadingCsv ? "Please wait for CSV upload to complete" : "Add at least one lead to start batch calling"}
                          >
                            ▶️ Start Batch
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                {/* CSV Upload Success Banner */}
                {csvUploadSuccessBanner && (
                  <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm font-semibold text-green-900">
                          Leads uploaded successfully
                        </p>
                      </div>
                      <button
                        onClick={startBatchCall}
                        disabled={isStartingBatch || !!(batchJob && (batchJob.status === 'RUNNING' || batchJob.status === 'PAUSED'))}
                        className="px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                      >
                        {isStartingBatch ? (
                          <>
                            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Starting...
                          </>
                        ) : (
                          <>
                            <span>🤖</span>
                            Start AI Calling
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Toggle for Low-Interest Leads */}
                {contacts.length > 0 && (
                  <div className="mb-4 px-2 sm:px-0">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showLowInterestLeads}
                        onChange={toggleLowInterestLeads}
                        className="w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
                      />
                      <span className="text-sm text-gray-700">Show low-interest leads</span>
                    </label>
                  </div>
                )}

                {/* Empty State - All leads filtered */}
                {contacts.length > 0 && sortedAndFilteredContacts.length === 0 && (
                  <div className="text-center py-12 px-4">
                    <p className="text-sm text-gray-500 mb-3">
                      All leads are hidden. Toggle "Show low-interest leads" to see them.
                    </p>
                    <button
                      onClick={toggleLowInterestLeads}
                      className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 transition-colors"
                    >
                      Show low-interest leads
                    </button>
                  </div>
                )}

                {/* Contacts List - Responsive Card Style */}
                {sortedAndFilteredContacts.length > 0 && (
                  <div className="space-y-2 px-2 sm:px-0">
                      {sortedAndFilteredContacts.map((cc) => {
                        // Determine left border color based on status
                        const borderColorClass = 
                          cc.status === 'HOT' ? 'border-l-4 border-red-500' :
                          cc.status === 'WARM' ? 'border-l-4 border-amber-500' :
                          'border-l-0';
                        
                        return (
                        <div
                          key={cc.id}
                          className={`group bg-white rounded-lg border border-gray-200 ${borderColorClass} ${
                            // Mobile: stacked, Tablet/Desktop: horizontal flex
                            'md:flex md:items-center md:justify-between md:p-5 lg:p-6 md:min-h-[100px] md:cursor-pointer'
                          } ${
                            // Desktop hover effects (disabled on mobile/touch devices)
                            'md:hover:border-gray-300 md:hover:shadow-md md:hover:-translate-y-0.5'
                          }`}
                          style={{
                            transition: 'all 150ms ease-out'
                          }}
                          onClick={(e) => {
                            // Only open drawer on desktop/tablet click, mobile uses More button
                            if (window.innerWidth >= 768) {
                              openLeadDrawer(cc, e);
                            }
                          }}
                        >
                          {/* Mobile: Stacked Card Layout */}
                          <div className="md:hidden p-4 space-y-3">
                            {/* Lead Identity */}
                            <div>
                              <div className="text-sm font-semibold text-gray-900">
                                {cc.contact?.name || cc.contactId}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {cc.contact?.phone}
                              </div>
                            </div>

                            {/* Status Badge - Mobile: above buttons */}
                            <div className="flex items-center gap-2">
                              <LeadStatusBadge status={cc.status} />
                            </div>

                            {/* Last Call - Mobile */}
                            <div className="text-xs text-gray-400">
                              Last call: {cc.lastCallAt ? new Date(cc.lastCallAt).toLocaleString() : '—'}
                            </div>

                            {/* Action Buttons - Mobile: Primary action only */}
                            <div className="flex gap-2 pt-2 border-t border-gray-100">
                              <button
                                className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 active:scale-[0.97] transition-all"
                                style={{
                                  transition: 'all 120ms ease-out'
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startCall(cc.id);
                                }}
                              >
                                Start Call
                              </button>
                              <button
                                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 active:scale-[0.97] transition-all"
                                style={{
                                  transition: 'all 120ms ease-out'
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openLeadDrawer(cc, e);
                                }}
                                aria-label="More options"
                              >
                                More
                              </button>
                            </div>
                          </div>

                          {/* Tablet & Desktop: Horizontal Flex Layout */}
                          <div className="hidden md:flex md:items-center md:justify-between md:w-full md:gap-4 lg:gap-6">
                            {/* Left Section: Lead Identity */}
                            <div className="min-w-0 flex-1">
                              <div className="text-base lg:text-sm font-semibold text-gray-900 truncate">
                                {cc.contact?.name || cc.contactId}
                              </div>
                              <div className="text-sm lg:text-xs font-mono text-gray-500 mt-1">
                                {cc.contact?.phone}
                              </div>
                              {/* Last Call - Prevent layout shift with fixed height */}
                              <div className="text-xs text-gray-400 mt-2 min-h-[16px]">
                                {cc.lastCallAt ? `Last call: ${new Date(cc.lastCallAt).toLocaleString()}` : ''}
                              </div>
                            </div>

                            {/* Right Section: Status Badge + Action Buttons - Right-aligned on desktop */}
                            <div className="flex flex-col items-end gap-3 flex-shrink-0 xl:flex-row xl:items-center" onClick={(e) => e.stopPropagation()}>
                              {/* Status Badge - Before buttons on desktop (≥1280px) */}
                              <div className="flex items-center gap-2">
                                <LeadStatusBadge status={cc.status} />
                                <span className="hidden xl:inline">
                                  {cc.humanOverride && (
                                    <span
                                      className="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700"
                                      title="Human Override Active"
                                    >
                                      Human Controlled
                                    </span>
                                  )}
                                  {cc.outcome && (
                                    <span
                                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                        cc.outcome.bucket === 'VERY_HIGH'
                                          ? 'bg-red-100 text-red-700'
                                          : cc.outcome.bucket === 'HIGH'
                                          ? 'bg-orange-100 text-orange-700'
                                          : cc.outcome.bucket === 'MEDIUM'
                                          ? 'bg-yellow-100 text-yellow-700'
                                          : 'bg-gray-100 text-gray-700'
                                      }`}
                                      title={`Outcome: ${cc.outcome.bucket}`}
                                    >
                                      {cc.outcome.bucket === 'VERY_HIGH' ? 'High Intent' :
                                       cc.outcome.bucket === 'HIGH' ? 'Likely' :
                                       cc.outcome.bucket === 'MEDIUM' ? 'Follow-up' :
                                       cc.outcome.bucket === 'LOW' ? 'Low' :
                                       'Not Interested'}
                                    </span>
                                  )}
                                </span>
                              </div>

                              {/* Action Buttons - Inline with spacing, right-aligned */}
                              <div className="flex items-center gap-2 lg:gap-3">
                                <button
                                  className="px-3 lg:px-4 py-1.5 lg:py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 active:scale-[0.97] transition-all"
                                  style={{
                                    transition: prefersReducedMotion ? 'none' : 'all 120ms ease-out'
                                  }}
                                  onClick={() => startCall(cc.id)}
                                >
                                  Start Call
                                </button>
                                <button
                                  className="px-3 lg:px-4 py-1.5 lg:py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 active:scale-[0.97] transition-all"
                                  style={{
                                    transition: prefersReducedMotion ? 'none' : 'all 120ms ease-out'
                                  }}
                                  onClick={() => openApplyScoreModal(cc.id)}
                                >
                                  Apply Score
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <p className="text-sm text-gray-500">Select a campaign to see contacts</p>
                  </div>
                </div>
              )}
              </div>
            </div>
          </main>
        </div>

      {/* Sticky "Start Batch Call" CTA */}
      {showStickyCTA && (
        <>
          {/* Mobile: Full-width sticky bar */}
          <div 
            className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-40"
            style={{ 
              paddingBottom: 'env(safe-area-inset-bottom, 0)',
              height: '56px',
              transition: prefersReducedMotion 
                ? 'none' 
                : 'transform 180ms ease-out, opacity 180ms ease-out',
              transform: stickyCTAAnimating ? 'translateY(0)' : 'translateY(16px)',
              opacity: stickyCTAAnimating ? 1 : 0
            }}
          >
            <div className="h-full px-4 flex items-center">
              <button
                onClick={startBatchCall}
                disabled={isStartingBatch}
                className="w-full h-full bg-emerald-600 text-white text-base font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                style={{
                  transition: prefersReducedMotion ? 'none' : 'all 120ms ease-out'
                }}
                aria-label="Start Batch Call"
              >
                {isStartingBatch ? (
                  <>
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Starting...</span>
                  </>
                ) : (
                  <>
                    <span>▶️</span>
                    <span>Start Batch Call</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Desktop: Sticky bottom-right CTA */}
          <div
            className="hidden lg:block fixed bottom-6 right-6 z-40"
            style={{
              transition: prefersReducedMotion 
                ? 'none' 
                : 'transform 180ms ease-out, opacity 180ms ease-out',
              transform: stickyCTAAnimating ? 'translateY(0)' : 'translateY(16px)',
              opacity: stickyCTAAnimating ? 1 : 0
            }}
          >
            <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-4 min-w-[280px]">
              <button
                onClick={startBatchCall}
                disabled={isStartingBatch}
                className="w-full px-6 py-3 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 active:scale-[0.97]"
                style={{
                  transition: prefersReducedMotion ? 'none' : 'all 120ms ease-out'
                }}
                aria-label="Start Batch Call"
              >
                {isStartingBatch ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Starting...</span>
                  </>
                ) : (
                  <>
                    <span>▶️</span>
                    <span>Start Batch Call</span>
                  </>
                )}
              </button>
              <p className="text-xs text-gray-500 text-center mt-2">
                AI will call eligible leads one by one
              </p>
            </div>
          </div>
        </>
      )}

      {/* Batch Control Bar - Fixed at bottom with fade-up animation */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{
          opacity: batchJob ? 1 : 0,
          transform: batchJob ? 'translateY(0)' : 'translateY(100%)',
          transition: prefersReducedMotion 
            ? 'none' 
            : 'opacity 200ms ease-out, transform 200ms ease-out',
          pointerEvents: batchJob ? 'auto' : 'none'
        }}
      >
        <BatchControlBar
          batchJob={batchJob}
          isLoading={batchActionLoading}
          onPause={async () => {
            if (!batchJob?.batchJobId || batchActionLoading) return;
            setBatchActionLoading(true);
            try {
              if (mockMode) {
                setToast('(Mock) Batch paused');
                return;
              }
              const res = await apiFetch(`${API_BASE}/batch/pause/${batchJob.batchJobId}`, {
                method: 'POST',
              });
              if ((res as any).ok) {
                setToast('Batch paused');
              }
            } catch (err: any) {
              setToast(`Failed to pause batch: ${err?.message || err}`);
            } finally {
              setBatchActionLoading(false);
            }
          }}
          onResume={async () => {
            if (!batchJob?.batchJobId || batchActionLoading) return;
            setBatchActionLoading(true);
            try {
              if (mockMode) {
                setToast('(Mock) Batch resumed');
                return;
              }
              const res = await apiFetch(`${API_BASE}/batch/resume/${batchJob.batchJobId}`, {
                method: 'POST',
              });
              if ((res as any).ok) {
                setToast('Batch resumed');
              }
            } catch (err: any) {
              setToast(`Failed to resume batch: ${err?.message || err}`);
            } finally {
              setBatchActionLoading(false);
            }
          }}
          onStop={async () => {
            if (!batchJob?.batchJobId || batchActionLoading) return;
            setBatchActionLoading(true);
            try {
              if (mockMode) {
                setToast('(Mock) Batch stopped');
                return;
              }
              const res = await apiFetch(`${API_BASE}/batch/stop/${batchJob.batchJobId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cancelledBy: 'User' }),
              });
              if ((res as any).ok) {
                setToast('Batch stopped');
              }
            } catch (err: any) {
              setToast(`Failed to stop batch: ${err?.message || err}`);
            } finally {
              setBatchActionLoading(false);
            }
        }}
        mockMode={mockMode}
      />
      </div>

      {toast && <div className="fixed right-6 bottom-6 bg-black text-white px-4 py-2 rounded shadow z-50">{toast}</div>}

      {/* CSV Upload Modal */}
      {showCsvUploadModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">Upload CSV Leads</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-700 font-medium mb-1">
                    CSV File <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="file"
                    accept=".csv"
                    className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setCsvFile(file);
                      }
                    }}
                    disabled={isUploadingCsv}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    CSV must have columns: <strong>name</strong>, <strong>phone</strong> (optional: <strong>source</strong>)
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    Phone numbers must be in E.164 format (e.g., +919876543210)
                  </p>
                </div>

                {csvUploadProgress && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
                    {csvUploadProgress}
                  </div>
                )}

                {/* Success Message with Start Batch Call Button */}
                {csvUploadSuccess && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-sm font-semibold text-green-900">
                        Successfully uploaded {csvUploadSuccess.leadCount} {csvUploadSuccess.leadCount === 1 ? 'lead' : 'leads'}!
                      </p>
                    </div>
                    <button
                      className="w-full px-4 py-3 bg-green-600 text-white text-sm font-semibold rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      onClick={async () => {
                        setShowCsvUploadModal(false);
                        setCsvFile(null);
                        setCsvUploadProgress(null);
                        setCsvUploadSuccess(null);
                        // Refresh contacts first, then start batch
                        if (selectedCampaign) {
                          await openCampaign(selectedCampaign);
                          // Small delay to ensure contacts are loaded
                          setTimeout(() => {
                            startBatchCall();
                          }, 500);
                        }
                      }}
                      disabled={isStartingBatch || !!(batchJob && (batchJob.status === 'RUNNING' || batchJob.status === 'PAUSED'))}
                    >
                      {isStartingBatch ? 'Starting...' : '🤖 Start AI Calling'}
                    </button>
                  </div>
                )}

                <div className="flex gap-3 justify-end pt-2">
                  <button
                    className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300 disabled:opacity-50"
                    onClick={() => {
                      setShowCsvUploadModal(false);
                      setCsvFile(null);
                      setCsvUploadProgress(null);
                      setCsvUploadSuccess(null);
                    }}
                    disabled={isUploadingCsv}
                  >
                    {csvUploadSuccess ? 'Close' : 'Cancel'}
                  </button>
                  <button
                    className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={async () => {
                      if (!selectedCampaign || !csvFile) {
                        alert('Please select a CSV file');
                        return;
                      }

                      if (mockMode) {
                        setCsvUploadSuccess({ leadCount: 10 }); // Mock count
                        setCsvUploadProgress(null);
                        return;
                      }

                      setIsUploadingCsv(true);
                      setCsvUploadProgress('Uploading CSV...');

                      try {
                        const formData = new FormData();
                        formData.append('csv', csvFile);

                        const res = await apiFetch(`${API_BASE}/leads/upload-csv/${selectedCampaign.id}`, {
                          method: 'POST',
                          body: formData,
                          // Do NOT set Content-Type header - browser will set it with boundary
                        });

                        // Check if response is ok
                        if (!res.ok) {
                          const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}: ${res.statusText}` }));
                          setCsvUploadProgress(`Error: ${errorData.error || errorData.details || 'Upload failed'}`);
                          return;
                        }

                        const data = await res.json();
                        if (data.ok) {
                          const { totalRows, created, duplicates, invalidRows } = data;
                          setCsvUploadSuccess({ leadCount: created });
                          setCsvUploadSuccessBanner({ leadCount: created });
                          setToast(
                            `CSV upload complete: ${created} created, ${duplicates} duplicates, ${invalidRows} invalid out of ${totalRows} total`
                          );
                          setCsvUploadProgress(null);
                          setShowCsvUploadModal(false);
                          // Refresh contacts to see new leads
                          if (selectedCampaign) {
                            await openCampaign(selectedCampaign);
                          }
                        } else {
                          setCsvUploadProgress(`Error: ${data.error || data.details || 'Upload failed'}`);
                        }
                      } catch (err: any) {
                        console.error('Failed to upload CSV:', err);
                        const errorMessage = err?.message || 'Failed to upload CSV. Please check your connection.';
                        setCsvUploadProgress(errorMessage);
                        setToast(errorMessage);
                      } finally {
                        setIsUploadingCsv(false);
                      }
                    }}
                    disabled={isUploadingCsv || !csvFile || !selectedCampaign}
                  >
                    {isUploadingCsv ? 'Uploading...' : 'Upload CSV'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* New Campaign Modal - 3-Step Wizard */}
        {showNewCampaignModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              {/* Wizard Header */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold mb-2">Create New Campaign</h3>
                <div className="flex items-center gap-2">
                  <div className={`flex items-center gap-2 ${wizardStep >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      wizardStep >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {wizardStep > 1 ? '✓' : '1'}
                    </div>
                    <span className="text-xs font-medium">Basics</span>
                  </div>
                  <div className={`h-0.5 w-8 ${wizardStep >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
                  <div className={`flex items-center gap-2 ${wizardStep >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      wizardStep >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
                    }`}>
                      {wizardStep > 2 ? '✓' : '2'}
                    </div>
                    <span className="text-xs font-medium">Knowledge Source</span>
                  </div>
                  <div className={`h-0.5 w-8 ${wizardStep >= 3 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
                  <div className={`flex items-center gap-2 ${wizardStep >= 3 ? 'text-blue-600' : 'text-gray-400'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                      wizardStep >= 3 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
                    }`}>
                      3
                    </div>
                    <span className="text-xs font-medium">Details</span>
                  </div>
                </div>
              </div>

              {/* Step 1: Campaign Basics */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-700 font-medium mb-1">
                      Campaign Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      className={`w-full text-sm border rounded px-3 py-2 ${
                        campaignFormError ? 'border-red-300' : 'border-gray-300'
                      }`}
                      value={newCampaignForm.name}
                      onChange={(e) => {
                        setNewCampaignForm({ ...newCampaignForm, name: e.target.value });
                        setCampaignFormError(null);
                      }}
                      placeholder="Enter campaign name"
                      disabled={isCreatingCampaign}
                    />
                    {campaignFormError && (
                      <p className="mt-1 text-xs text-red-600">{campaignFormError}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 font-medium mb-1">
                      Property (Optional)
                    </label>
                    <input
                      type="text"
                      className="w-full text-sm border border-gray-300 rounded px-3 py-2 bg-gray-50"
                      value={newCampaignForm.propertyId}
                      onChange={(e) => setNewCampaignForm({ ...newCampaignForm, propertyId: e.target.value })}
                      placeholder="Property ID (optional)"
                      disabled={isCreatingCampaign}
                    />
                    <p className="mt-1 text-xs text-gray-500">Leave empty if no property</p>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 font-medium mb-2">
                      Caller Identity
                    </label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="callerIdentityMode"
                          value="GENERIC"
                          checked={newCampaignForm.callerIdentityMode === 'GENERIC'}
                          onChange={(e) => setNewCampaignForm({ 
                            ...newCampaignForm, 
                            callerIdentityMode: e.target.value as 'GENERIC' | 'PERSONALIZED',
                            callerDisplayName: e.target.value === 'GENERIC' ? '' : newCampaignForm.callerDisplayName,
                          })}
                          disabled={isCreatingCampaign}
                          className="cursor-pointer"
                        />
                        <span className="text-sm text-gray-700">Generic AI Caller</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="callerIdentityMode"
                          value="PERSONALIZED"
                          checked={newCampaignForm.callerIdentityMode === 'PERSONALIZED'}
                          onChange={(e) => setNewCampaignForm({ 
                            ...newCampaignForm, 
                            callerIdentityMode: e.target.value as 'GENERIC' | 'PERSONALIZED',
                          })}
                          disabled={isCreatingCampaign}
                          className="cursor-pointer"
                        />
                        <span className="text-sm text-gray-700">Personalized Caller (on behalf of logged-in user)</span>
                      </label>
                    </div>
                    {newCampaignForm.callerIdentityMode === 'PERSONALIZED' && (
                      <div className="mt-3">
                        <label className="block text-sm text-gray-700 font-medium mb-1">
                          Caller name shown to leads <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                          value={newCampaignForm.callerDisplayName}
                          onChange={(e) => setNewCampaignForm({ ...newCampaignForm, callerDisplayName: e.target.value })}
                          placeholder="e.g., John Smith"
                          disabled={isCreatingCampaign}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 justify-end pt-4">
                    <button
                      className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300 disabled:opacity-50"
                      onClick={() => {
                        setShowNewCampaignModal(false);
                        setWizardStep(1);
                        setKnowledgeSource(null);
                        setNewCampaignForm({ 
                          name: '', 
                          propertyId: '',
                          callerIdentityMode: 'GENERIC',
                          callerDisplayName: '',
                          campaignKnowledge: {
                            priceRange: '',
                            amenities: [],
                            location: '',
                            possession: '',
                            highlights: [],
                          },
                          voiceTranscript: '',
                          voiceTranscriptLanguage: null,
                          voiceKnowledge: null,
                          knowledgeUsageMode: 'INTERNAL_ONLY',
                        });
                        setAudioBlob(null);
                        setIsRecording(false);
                        if (mediaRecorder) {
                          mediaRecorder.stop();
                          setMediaRecorder(null);
                        }
                        setCampaignFormError(null);
                      }}
                      disabled={isCreatingCampaign}
                    >
                      Cancel
                    </button>
                    <button
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => {
                        if (!newCampaignForm.name || newCampaignForm.name.trim().length === 0) {
                          setCampaignFormError('Campaign name is required');
                          return;
                        }
                        if (newCampaignForm.callerIdentityMode === 'PERSONALIZED' && 
                            (!newCampaignForm.callerDisplayName || newCampaignForm.callerDisplayName.trim().length === 0)) {
                          setCampaignFormError('Caller name is required when using Personalized Caller');
                          return;
                        }
                        setCampaignFormError(null);
                        setWizardStep(2);
                      }}
                      disabled={isCreatingCampaign || !newCampaignForm.name || newCampaignForm.name.trim().length === 0}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Knowledge Source Selection */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-700 font-medium mb-3">
                      Knowledge Source <span className="text-red-500">*</span>
                    </label>
                    <div className="space-y-3">
                      <label className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                        knowledgeSource === 'MANUAL' 
                          ? 'border-blue-500 bg-blue-50' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}>
                        <input
                          type="radio"
                          name="knowledgeSource"
                          value="MANUAL"
                          checked={knowledgeSource === 'MANUAL'}
                          onChange={(e) => {
                            setKnowledgeSource('MANUAL');
                            setCampaignFormError(null);
                          }}
                          disabled={isCreatingCampaign}
                          className="cursor-pointer mt-0.5"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-900">Manual Text Entry</div>
                          <div className="text-xs text-gray-500 mt-1">Enter property details using structured text fields</div>
                        </div>
                      </label>
                      <label className={`flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all ${
                        knowledgeSource === 'VOICE' 
                          ? 'border-blue-500 bg-blue-50' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}>
                        <input
                          type="radio"
                          name="knowledgeSource"
                          value="VOICE"
                          checked={knowledgeSource === 'VOICE'}
                          onChange={(e) => {
                            setKnowledgeSource('VOICE');
                            setCampaignFormError(null);
                          }}
                          disabled={isCreatingCampaign}
                          className="cursor-pointer mt-0.5"
                        />
                        <div className="flex-1">
                          <div className="text-sm font-medium text-gray-900">Voice Recording / Upload</div>
                          <div className="text-xs text-gray-500 mt-1">Record or upload audio to generate structured knowledge</div>
                        </div>
                      </label>
                    </div>
                    {campaignFormError && knowledgeSource === null && (
                      <p className="mt-2 text-xs text-red-600">{campaignFormError}</p>
                    )}
                  </div>
                  <div className="flex gap-3 justify-end pt-4">
                    <button
                      className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300 disabled:opacity-50"
                      onClick={() => {
                        setWizardStep(1);
                        setCampaignFormError(null);
                      }}
                      disabled={isCreatingCampaign}
                    >
                      Back
                    </button>
                    <button
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => {
                        if (!knowledgeSource) {
                          setCampaignFormError('Please select a knowledge source');
                          return;
                        }
                        setCampaignFormError(null);
                        setWizardStep(3);
                      }}
                      disabled={isCreatingCampaign || !knowledgeSource}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Knowledge Details */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  {knowledgeSource === 'MANUAL' ? (
                    <>
                      <div>
                        <label className="block text-sm text-gray-700 font-medium mb-3">
                          Property Knowledge
                        </label>
                        <p className="text-xs text-gray-500 mb-3">Structured property information for AI calls</p>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs text-gray-600 font-medium mb-1">
                              Price Range
                            </label>
                            <input
                              type="text"
                              className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                              value={newCampaignForm.campaignKnowledge.priceRange}
                              onChange={(e) => setNewCampaignForm({ 
                                ...newCampaignForm, 
                                campaignKnowledge: {
                                  ...newCampaignForm.campaignKnowledge,
                                  priceRange: e.target.value,
                                },
                              })}
                              placeholder="e.g., ₹1.2 Cr - ₹2.5 Cr"
                              disabled={isCreatingCampaign}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 font-medium mb-1">
                              Location
                            </label>
                            <input
                              type="text"
                              className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                              value={newCampaignForm.campaignKnowledge.location}
                              onChange={(e) => setNewCampaignForm({ 
                                ...newCampaignForm, 
                                campaignKnowledge: {
                                  ...newCampaignForm.campaignKnowledge,
                                  location: e.target.value,
                                },
                              })}
                              placeholder="e.g., Downtown, Near Metro Station"
                              disabled={isCreatingCampaign}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 font-medium mb-1">
                              Possession
                            </label>
                            <input
                              type="text"
                              className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                              value={newCampaignForm.campaignKnowledge.possession}
                              onChange={(e) => setNewCampaignForm({ 
                                ...newCampaignForm, 
                                campaignKnowledge: {
                                  ...newCampaignForm.campaignKnowledge,
                                  possession: e.target.value,
                                },
                              })}
                              placeholder="e.g., Ready to Move, Dec 2025"
                              disabled={isCreatingCampaign}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 font-medium mb-1">
                              Amenities (comma-separated)
                            </label>
                            <input
                              type="text"
                              className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                              value={newCampaignForm.campaignKnowledge.amenities.join(', ')}
                              onChange={(e) => setNewCampaignForm({ 
                                ...newCampaignForm, 
                                campaignKnowledge: {
                                  ...newCampaignForm.campaignKnowledge,
                                  amenities: e.target.value.split(',').map(s => s.trim()).filter(s => s.length > 0),
                                },
                              })}
                              placeholder="e.g., Swimming Pool, Gym, Park, Clubhouse"
                              disabled={isCreatingCampaign}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 font-medium mb-1">
                              Highlights (comma-separated)
                            </label>
                            <input
                              type="text"
                              className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                              value={newCampaignForm.campaignKnowledge.highlights.join(', ')}
                              onChange={(e) => setNewCampaignForm({ 
                                ...newCampaignForm, 
                                campaignKnowledge: {
                                  ...newCampaignForm.campaignKnowledge,
                                  highlights: e.target.value.split(',').map(s => s.trim()).filter(s => s.length > 0),
                                },
                              })}
                              placeholder="e.g., RERA Approved, Premium Location, Best Builder"
                              disabled={isCreatingCampaign}
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm text-gray-700 font-medium mb-3">
                          Voice Knowledge
                        </label>
                        <p className="text-xs text-gray-500 mb-3">Record or upload audio in English, Hindi, or Hinglish</p>
                        
                        {/* Voice Recording/Upload */}
                        <div className="space-y-3">
                          <div className="flex gap-2 flex-wrap">
                            {!isRecording && !audioBlob && (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                                      const recorder = new MediaRecorder(stream);
                                      const chunks: BlobPart[] = [];

                                      recorder.ondataavailable = (e) => {
                                        if (e.data.size > 0) {
                                          chunks.push(e.data);
                                        }
                                      };

                                      recorder.onstop = () => {
                                        const blob = new Blob(chunks, { type: 'audio/webm' });
                                        setAudioBlob(blob);
                                        stream.getTracks().forEach(track => track.stop());
                                      };

                                      recorder.start();
                                      setMediaRecorder(recorder);
                                      setIsRecording(true);
                                    } catch (err) {
                                      console.error('Failed to start recording:', err);
                                      setToast('Failed to access microphone. Please check permissions.');
                                    }
                                  }}
                                  className="px-3 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 disabled:opacity-50"
                                  disabled={isCreatingCampaign}
                                >
                                  🎤 Start Recording
                                </button>
                                <label className="px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 cursor-pointer disabled:opacity-50">
                                  📁 Upload Audio
                                  <input
                                    type="file"
                                    accept="audio/*"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        setAudioBlob(file);
                                      }
                                    }}
                                    disabled={isCreatingCampaign}
                                  />
                                </label>
                              </>
                            )}
                            
                            {isRecording && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                                    mediaRecorder.stop();
                                    setIsRecording(false);
                                    setMediaRecorder(null);
                                  }
                                }}
                                className="px-3 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700"
                              >
                                ⏹️ Stop Recording
                              </button>
                            )}

                            {audioBlob && !isTranscribing && (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-gray-600">Audio ready</span>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (!audioBlob) return;
                                    
                                    setIsTranscribing(true);
                                    try {
                                      const formData = new FormData();
                                      formData.append('audio', audioBlob);

                                      const res = await apiFetch(`${API_BASE}/api/campaigns/transcribe-audio`, {
                                        method: 'POST',
                                        body: formData,
                                      });

                                      const data = await res.json();
                                      if (data.ok) {
                                        setNewCampaignForm({
                                          ...newCampaignForm,
                                          voiceTranscript: data.transcript,
                                          voiceTranscriptLanguage: data.language,
                                        });
                                        setToast('Audio transcribed successfully');
                                      } else {
                                        setToast(`Transcription failed: ${data.error}`);
                                      }
                                    } catch (err: any) {
                                      console.error('Transcription error:', err);
                                      setToast('Failed to transcribe audio');
                                    } finally {
                                      setIsTranscribing(false);
                                    }
                                  }}
                                  className="px-3 py-2 bg-green-600 text-white text-sm font-medium rounded hover:bg-green-700"
                                  disabled={isCreatingCampaign}
                                >
                                  {isTranscribing ? 'Transcribing...' : '📝 Transcribe'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAudioBlob(null);
                                    setNewCampaignForm({
                                      ...newCampaignForm,
                                      voiceTranscript: '',
                                      voiceTranscriptLanguage: null,
                                      voiceKnowledge: null,
                                    });
                                  }}
                                  className="px-3 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300"
                                >
                                  ✕ Clear
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Transcript Display */}
                          {newCampaignForm.voiceTranscript && (
                            <div className="p-3 bg-gray-50 border border-gray-200 rounded">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-gray-700">
                                  Transcript ({newCampaignForm.voiceTranscriptLanguage || 'unknown'})
                                </span>
                                {!newCampaignForm.voiceKnowledge && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!newCampaignForm.voiceTranscript) return;
                                      
                                      setIsGeneratingKnowledge(true);
                                      try {
                                        const res = await apiFetch(`${API_BASE}/api/campaigns/generate-knowledge`, {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({
                                            transcript: newCampaignForm.voiceTranscript,
                                          }),
                                        });

                                        const data = await res.json();
                                        if (data.ok) {
                                          setNewCampaignForm({
                                            ...newCampaignForm,
                                            voiceKnowledge: data.knowledge,
                                          });
                                          setToast('Knowledge generated successfully');
                                        } else {
                                          setToast(`Knowledge generation failed: ${data.error}`);
                                        }
                                      } catch (err: any) {
                                        console.error('Knowledge generation error:', err);
                                        setToast('Failed to generate knowledge');
                                      } finally {
                                        setIsGeneratingKnowledge(false);
                                      }
                                    }}
                                    className="px-2 py-1 bg-purple-600 text-white text-xs font-medium rounded hover:bg-purple-700"
                                    disabled={isGeneratingKnowledge || isCreatingCampaign}
                                  >
                                    {isGeneratingKnowledge ? 'Generating...' : '🧠 Generate Knowledge'}
                                  </button>
                                )}
                              </div>
                              <p className="text-xs text-gray-600 whitespace-pre-wrap">{newCampaignForm.voiceTranscript}</p>
                            </div>
                          )}

                          {/* Generated Knowledge Display */}
                          {newCampaignForm.voiceKnowledge && (
                            <div className="p-3 bg-purple-50 border border-purple-200 rounded">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-purple-900">Generated Knowledge (Internal Use Only)</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewCampaignForm({
                                      ...newCampaignForm,
                                      voiceKnowledge: null,
                                    });
                                  }}
                                  className="text-xs text-purple-600 hover:text-purple-700"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="space-y-2 text-xs">
                                {newCampaignForm.voiceKnowledge.safeTalkingPoints && newCampaignForm.voiceKnowledge.safeTalkingPoints.length > 0 && (
                                  <div>
                                    <span className="font-medium text-gray-700">Safe Talking Points:</span>
                                    <ul className="list-disc list-inside ml-2 text-gray-600">
                                      {newCampaignForm.voiceKnowledge.safeTalkingPoints.map((point, idx) => (
                                        <li key={idx}>{point}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {newCampaignForm.voiceKnowledge.idealBuyerProfile && (
                                  <div>
                                    <span className="font-medium text-gray-700">Ideal Buyer:</span>
                                    <span className="text-gray-600 ml-2">{newCampaignForm.voiceKnowledge.idealBuyerProfile}</span>
                                  </div>
                                )}
                                {newCampaignForm.voiceKnowledge.objectionsLikely && newCampaignForm.voiceKnowledge.objectionsLikely.length > 0 && (
                                  <div>
                                    <span className="font-medium text-gray-700">Likely Objections:</span>
                                    <span className="text-gray-600 ml-2">{newCampaignForm.voiceKnowledge.objectionsLikely.join(', ')}</span>
                                  </div>
                                )}
                                {newCampaignForm.voiceKnowledge.pricingConfidence && (
                                  <div>
                                    <span className="font-medium text-gray-700">Pricing Confidence:</span>
                                    <span className="text-gray-600 ml-2">{newCampaignForm.voiceKnowledge.pricingConfidence}</span>
                                  </div>
                                )}
                                {newCampaignForm.voiceKnowledge.doNotSay && newCampaignForm.voiceKnowledge.doNotSay.length > 0 && (
                                  <div>
                                    <span className="font-medium text-red-700">Do Not Say:</span>
                                    <ul className="list-disc list-inside ml-2 text-red-600">
                                      {newCampaignForm.voiceKnowledge.doNotSay.map((phrase, idx) => (
                                        <li key={idx}>{phrase}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                  <div className="flex gap-3 justify-end pt-4">
                    <button
                      className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300 disabled:opacity-50"
                      onClick={() => {
                        setWizardStep(2);
                        setCampaignFormError(null);
                      }}
                      disabled={isCreatingCampaign}
                    >
                      Back
                    </button>
                    <button
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={async () => {
                        if (mockMode) {
                          // Mock mode: create fake campaign
                          const mockCampaign: Campaign = {
                            id: `mock-${Date.now()}`,
                            name: newCampaignForm.name,
                            propertyId: newCampaignForm.propertyId || '',
                          };
                          setCampaigns((prev) => [mockCampaign, ...prev]);
                          setSelectedCampaign(mockCampaign);
                          setShowNewCampaignModal(false);
                          setWizardStep(1);
                          setKnowledgeSource(null);
                          setNewCampaignForm({ 
                            name: '', 
                            propertyId: '',
                            callerIdentityMode: 'GENERIC',
                            callerDisplayName: '',
                            campaignKnowledge: {
                              priceRange: '',
                              amenities: [],
                              location: '',
                              possession: '',
                              highlights: [],
                            },
                            voiceTranscript: '',
                            voiceTranscriptLanguage: null,
                            voiceKnowledge: null,
                            knowledgeUsageMode: 'INTERNAL_ONLY',
                          });
                          setAudioBlob(null);
                          setIsRecording(false);
                          if (mediaRecorder) {
                            mediaRecorder.stop();
                            setMediaRecorder(null);
                          }
                          setCampaignFormError(null);
                          setToast('(Mock) Campaign created successfully');
                          return;
                        }

                        setIsCreatingCampaign(true);
                        setCampaignFormError(null);
                        try {
                          const payload = {
                            name: newCampaignForm.name.trim(),
                            propertyId: newCampaignForm.propertyId || null,
                            callerIdentityMode: newCampaignForm.callerIdentityMode,
                            callerDisplayName: newCampaignForm.callerIdentityMode === 'PERSONALIZED' 
                              ? newCampaignForm.callerDisplayName.trim() 
                              : null,
                            campaignKnowledge: knowledgeSource === 'MANUAL' ? (() => {
                              const knowledge = newCampaignForm.campaignKnowledge;
                              const hasAnyValue = knowledge.priceRange || 
                                knowledge.location || 
                                knowledge.possession || 
                                knowledge.amenities.length > 0 || 
                                knowledge.highlights.length > 0;
                              
                              if (!hasAnyValue) {
                                return null;
                              }
                              
                              return {
                                ...(knowledge.priceRange && { priceRange: knowledge.priceRange }),
                                ...(knowledge.location && { location: knowledge.location }),
                                ...(knowledge.possession && { possession: knowledge.possession }),
                                ...(knowledge.amenities.length > 0 && { amenities: knowledge.amenities }),
                                ...(knowledge.highlights.length > 0 && { highlights: knowledge.highlights }),
                              };
                            })() : null,
                            voiceTranscript: knowledgeSource === 'VOICE' ? (newCampaignForm.voiceTranscript || null) : null,
                            voiceTranscriptLanguage: knowledgeSource === 'VOICE' ? (newCampaignForm.voiceTranscriptLanguage || null) : null,
                            voiceKnowledge: knowledgeSource === 'VOICE' ? (newCampaignForm.voiceKnowledge || null) : null,
                            knowledgeUsageMode: newCampaignForm.knowledgeUsageMode,
                          };

                          // Log the exact request body sent to backend
                          console.log('[POST /api/campaigns] Frontend request body:', JSON.stringify(payload, null, 2));
                          console.log('[POST /api/campaigns] Frontend POSTing to:', `${API_BASE}/api/campaigns`);
                          
                          const response = await apiFetch(`${API_BASE}/api/campaigns`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                          });

                          // Log API response
                          console.log('[POST /api/campaigns] Frontend response status:', response.status);
                          console.log('[POST /api/campaigns] Frontend response data:', JSON.stringify(response.data, null, 2));

                          // Treat success ONLY when backend returns 201
                          if (response.status === 201 && response.data?.ok && response.data?.campaign) {
                            // Optimistically append campaign to sidebar state
                            setCampaigns((prev) => {
                              // Check if campaign already exists (avoid duplicates)
                              const exists = prev.some((c) => c.id === response.data.campaign.id);
                              if (exists) {
                                return prev;
                              }
                              // Add new campaign at the top
                              return [response.data.campaign, ...prev];
                            });
                            
                            // Close modal and reset wizard ONLY after successful 201 response
                            setShowNewCampaignModal(false);
                            setWizardStep(1);
                            setKnowledgeSource(null);
                            setNewCampaignForm({ 
                              name: '', 
                              propertyId: '',
                              callerIdentityMode: 'GENERIC',
                              callerDisplayName: '',
                              campaignKnowledge: {
                                priceRange: '',
                                amenities: [],
                                location: '',
                                possession: '',
                                highlights: [],
                              },
                              voiceTranscript: '',
                              voiceTranscriptLanguage: null,
                              voiceKnowledge: null,
                              knowledgeUsageMode: 'INTERNAL_ONLY',
                            });
                            setAudioBlob(null);
                            setIsRecording(false);
                            if (mediaRecorder) {
                              mediaRecorder.stop();
                              setMediaRecorder(null);
                            }
                            setCampaignFormError(null);
                            
                            // Refetch campaigns after creation to ensure persistence
                            await fetchCampaigns();
                            
                            setToast('Campaign created successfully');
                          } else {
                            // On failure, show backend error message verbatim
                            const backendError = response.data?.error || 'Failed to create campaign';
                            console.error('[POST /api/campaigns] Backend returned error (status:', response.status, '):', backendError);
                            setCampaignFormError(backendError);
                          }
                        } catch (err: any) {
                          console.error('[POST /api/campaigns] Frontend error:', err);
                          // Try to extract backend error message from response
                          let errorMessage = 'Failed to create campaign. Please check your connection.';
                          
                          // Check if error message contains backend error (from authenticatedFetch)
                          if (err?.message) {
                            // If it's an HTTP error, try to parse the response
                            if (err.message.includes('HTTP')) {
                              // Extract error from HTTP response if available
                              // Format: "HTTP 400: {"ok":false,"error":"..."}"
                              const match = err.message.match(/HTTP \d+: (.+)/);
                              if (match && match[1]) {
                                try {
                                  const parsed = JSON.parse(match[1]);
                                  // Backend returns { ok: false, error: "..." }
                                  errorMessage = parsed.error || parsed.message || match[1];
                                } catch {
                                  // If not JSON, use the text as-is
                                  errorMessage = match[1];
                                }
                              } else {
                                errorMessage = err.message;
                              }
                            } else {
                              errorMessage = err.message;
                            }
                          }
                          
                          // Show backend error message verbatim
                          console.log('[POST /api/campaigns] Showing error to user:', errorMessage);
                          setCampaignFormError(errorMessage);
                        } finally {
                          setIsCreatingCampaign(false);
                        }
                      }}
                      disabled={isCreatingCampaign}
                    >
                      {isCreatingCampaign ? 'Creating...' : 'Create Campaign'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Add Lead Modal */}
        {showAddLeadModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">Add Lead</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-700 font-medium mb-1">
                    Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                    value={addLeadForm.name}
                    onChange={(e) => setAddLeadForm({ ...addLeadForm, name: e.target.value })}
                    placeholder="Enter lead name"
                    disabled={isAddingLead}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 font-medium mb-1">
                    Phone <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    className="w-full text-sm border border-gray-300 rounded px-3 py-2"
                    value={addLeadForm.phone}
                    onChange={(e) => setAddLeadForm({ ...addLeadForm, phone: e.target.value })}
                    placeholder="+919876543210 (E.164 format)"
                    disabled={isAddingLead}
                  />
                  <p className="text-xs text-gray-500 mt-1">Format: +[country code][number]</p>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 font-medium mb-1">Source</label>
                  <input
                    type="text"
                    className="w-full text-sm border border-gray-300 rounded px-3 py-2 bg-gray-100"
                    value="MANUAL"
                    readOnly
                    disabled
                  />
                </div>
                <div className="flex gap-3 justify-end pt-2">
                  <button
                    className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300 disabled:opacity-50"
                    onClick={() => {
                      setShowAddLeadModal(false);
                      setAddLeadForm({ name: '', phone: '' });
                    }}
                    disabled={isAddingLead}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={async () => {
                      if (!selectedCampaign || !addLeadForm.name || !addLeadForm.phone) {
                        alert('Please fill in all required fields');
                        return;
                      }

                      if (mockMode) {
                        alert('(Mock) Lead added successfully');
                        setShowAddLeadModal(false);
                        setAddLeadForm({ name: '', phone: '' });
                        return;
                      }

                      setIsAddingLead(true);
                      try {
                        const res = await apiFetch(`${API_BASE}/leads/create`, {
                          method: 'POST',
                          body: JSON.stringify({
                            campaignId: selectedCampaign.id,
                            name: addLeadForm.name,
                            phone: addLeadForm.phone,
                            source: 'MANUAL',
                          }),
                        });

                        if (res.ok) {
                          setToast('Lead added successfully');
                          setShowAddLeadModal(false);
                          setAddLeadForm({ name: '', phone: '' });
                          // Lead will be added via SSE event LEAD_CREATED
                        } else {
                          alert(res.error || 'Failed to add lead');
                        }
                      } catch (err: any) {
                        console.error('Failed to add lead:', err);
                        if (err?.message?.includes('401') || err?.message?.includes('Authentication required')) {
                          alert('Authentication required. Please sign in.');
                        } else {
                          alert('Failed to add lead. Please check your connection.');
                        }
                      } finally {
                        setIsAddingLead(false);
                      }
                    }}
                    disabled={isAddingLead || !addLeadForm.name || !addLeadForm.phone}
                  >
                    {isAddingLead ? 'Adding...' : 'Add Lead'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Lead Drawer */}
        <LeadDrawer
          isOpen={drawerOpen}
          onClose={closeLeadDrawer}
          lead={selectedLead}
          campaignName={selectedCampaign?.name}
          mockMode={mockMode}
          onApplyScore={() => selectedLead && openApplyScoreModal(selectedLead.id)}
          onStartCall={() => selectedLead && startCall(selectedLead.id)}
          previousFocusElement={previousFocusElementRef.current}
          liveTimelineEvent={latestTimelineEvent}
          onLeadStatusUpdate={handleLeadStatusUpdate}
          isLiveConnected={isLiveConnected}
          isReconnecting={isReconnecting}
          sseError={sseError}
        />

        {showScoreModal && (
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center">
            <div className="bg-white rounded-lg p-6 w-[680px]">
              <h3 className="text-lg font-medium mb-3">Apply Score to Call</h3>
              <div className="mb-2">
                <label className="block text-sm text-gray-600">CallLog ID (existing call)</label>
                <input className="w-full border p-2 rounded mt-1" value={activeCallLogId || ""} onChange={(e) => setActiveCallLogId(e.target.value)} placeholder="Paste callLogId here (from CallLog table)" />
              </div>
              <div className="mb-2">
                <label className="block text-sm text-gray-600">Transcript</label>
                <textarea rows={6} className="w-full border p-2 rounded mt-1" value={transcript} onChange={(e) => setTranscript(e.target.value)} />
              </div>
              <div className="mb-4">
                <label className="block text-sm text-gray-600">Duration (seconds)</label>
                <input type="number" className="border p-2 rounded mt-1 w-32" value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value))} />
              </div>

              <div className="flex justify-end gap-2">
                <button className="px-4 py-2 border rounded" onClick={() => setShowScoreModal(false)}>
                  Cancel
                </button>
                <button className="px-4 py-2 bg-blue-600 text-white rounded" onClick={applyScore}>
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Contact Us Section */}
      <footer className="bg-white border-t border-gray-200 mt-16">
        <div className="max-w-[1440px] mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Contact Information */}
            <div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Contact Us</h2>
              <p className="text-gray-600 mb-6">
                Have questions or need support? We're here to help. Reach out to us through any of the following channels.
              </p>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Email</p>
                    <a href="mailto:support@callbot.com" className="text-sm text-blue-600 hover:text-blue-700">
                      support@callbot.com
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Phone</p>
                    <a href="tel:+1234567890" className="text-sm text-blue-600 hover:text-blue-700">
                      +1 (234) 567-890
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Address</p>
                    <p className="text-sm text-gray-600">
                      123 Business Street<br />
                      Suite 100<br />
                      City, State 12345
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Send us a message</h3>
              <form className="space-y-4" onSubmit={(e) => {
                e.preventDefault();
                setToast('Thank you for your message! We will get back to you soon.');
                // Reset form would go here
              }}>
                <div>
                  <label htmlFor="contact-name" className="block text-sm font-medium text-gray-700 mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    id="contact-name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label htmlFor="contact-email" className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    id="contact-email"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="your.email@example.com"
                  />
                </div>
                <div>
                  <label htmlFor="contact-message" className="block text-sm font-medium text-gray-700 mb-1">
                    Message
                  </label>
                  <textarea
                    id="contact-message"
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="How can we help you?"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
                >
                  Send Message
                </button>
              </form>
            </div>
          </div>
          
          {/* Footer Bottom */}
          <div className="mt-8 pt-8 border-t border-gray-200">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <p className="text-sm text-gray-500">
                © {new Date().getFullYear()} CallBot. All rights reserved.
              </p>
              <div className="flex items-center gap-6">
                <a href="#" className="text-sm text-gray-500 hover:text-gray-700">Privacy Policy</a>
                <a href="#" className="text-sm text-gray-500 hover:text-gray-700">Terms of Service</a>
                <a href="#" className="text-sm text-gray-500 hover:text-gray-700">Documentation</a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
