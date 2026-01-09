// pages/analytics.tsx
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@clerk/nextjs';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { authenticatedFetch, getApiBaseUrl } from '../utils/api';

type Campaign = { id: string; name: string; propertyId: string };

export default function AnalyticsPage() {
  const router = useRouter();
  const { campaignId } = router.query;
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [mockMode, setMockMode] = useState<boolean>(false);

  const API_BASE = getApiBaseUrl();

  // Load mock mode from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('callbot_mock_mode');
    if (saved === 'true') {
      setMockMode(true);
    }
  }, []);

  // Fetch campaign details
  useEffect(() => {
    if (!campaignId || typeof campaignId !== 'string') {
      setLoading(false);
      return;
    }

    // Wait for Clerk to load
    if (!isLoaded) {
      return;
    }

    // Check if user is signed in
    if (!isSignedIn) {
      setLoading(false);
      return;
    }

    const fetchCampaign = async () => {
      try {
        if (mockMode) {
          setCampaign({
            id: campaignId,
            name: 'Mock Campaign',
            propertyId: 'mock-property',
          });
          setLoading(false);
          return;
        }

        const token = await getToken();
        if (!token) {
          console.error('No token available');
          setLoading(false);
          return;
        }

        const data = await authenticatedFetch(`${API_BASE}/api/campaigns`, undefined, token);
        const campaigns = Array.isArray(data) ? data : data?.campaigns || [];
        const foundCampaign = campaigns.find((c: Campaign) => c.id === campaignId);
        
        if (foundCampaign) {
          setCampaign(foundCampaign);
          // Disable mock mode on successful backend response
          if (mockMode) {
            setMockMode(false);
          }
        }
      } catch (err: any) {
        console.error('Failed to fetch campaign:', err);
        // Don't activate mock mode on 401
        if (err?.message?.includes('401') || err?.message?.includes('Authentication required')) {
          // Auth error - don't activate mock mode
        } else if (err?.message?.includes('Network error')) {
          // Network error - could activate mock mode if needed
        }
      } finally {
        setLoading(false);
      }
    };

    fetchCampaign();
  }, [campaignId, API_BASE, mockMode, isLoaded, isSignedIn, getToken]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!campaignId || typeof campaignId !== 'string') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Analytics Dashboard</h1>
          <p className="text-gray-600">Please select a campaign to view analytics.</p>
          <button
            onClick={() => router.push('/')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/')}
                className="text-gray-600 hover:text-gray-900 transition-colors"
                aria-label="Back to home"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <h1 className="text-xl font-semibold text-gray-900">Analytics & Insights</h1>
            </div>
            <div className="flex items-center gap-3">
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
                  localStorage.setItem('callbot_mock_mode', String(newValue));
                }}
                className="cursor-pointer"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-[1440px] mx-auto">
        {/* Start Batch Call CTA */}
        {campaignId && typeof campaignId === 'string' && (
          <div className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Batch Calling</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Start automated calling for all eligible leads in this campaign
                </p>
              </div>
              <button
                onClick={async () => {
                  // Check Clerk state
                  if (!isLoaded || !isSignedIn) {
                    alert('Please sign in to start batch calls.');
                    return;
                  }

                  try {
                    const token = await getToken();
                    if (!token) {
                      alert('Authentication required. Please sign in.');
                      return;
                    }

                    const data = await authenticatedFetch(`${API_BASE}/batch/start/${campaignId}`, {
                      method: 'POST',
                      body: JSON.stringify({
                        cooldownHours: 24,
                        maxRetries: 2,
                      }),
                    }, token);
                    if (data.ok) {
                      alert(`Batch call started: ${data.totalLeads} leads queued`);
                      // Refresh page to show updated status
                      window.location.reload();
                    } else {
                      alert(data.error || data.message || 'Failed to start batch call');
                    }
                  } catch (err: any) {
                    console.error('Failed to start batch:', err);
                    if (err?.message?.includes('401') || err?.message?.includes('Authentication required')) {
                      alert('Authentication required. Please sign in.');
                    } else {
                      alert('Failed to start batch call. See console for details.');
                    }
                  }
                }}
                className="px-6 py-3 bg-emerald-600 text-white text-sm font-semibold rounded-md hover:bg-emerald-700 transition-colors"
              >
                ▶️ Start New Batch Call
              </button>
            </div>
          </div>
        )}
        <AnalyticsDashboard
          campaignId={campaignId}
          campaignName={campaign?.name}
          mockMode={mockMode}
        />
      </div>
    </div>
  );
}
