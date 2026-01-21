// pages/analytics.tsx
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AnalyticsDashboard } from '../components/AnalyticsDashboard';
import { authenticatedFetch, getApiBaseUrl } from '../utils/api';

type Campaign = { id: string; name: string; propertyId: string };

export default function AnalyticsPage() {
  const router = useRouter();
  const { campaignId } = router.query;
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [mockMode, setMockMode] = useState<boolean>(false);
  const [pinRequired, setPinRequired] = useState(true);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  const API_BASE = getApiBaseUrl();

  // Load mock mode from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('callbot_mock_mode');
    if (saved === 'true') {
      setMockMode(true);
    }
  }, []);

  // Load dashboard PIN from localStorage
  useEffect(() => {
    const savedPin = localStorage.getItem('dashboard_pin');
    if (savedPin) {
      setPinRequired(false);
    }
  }, []);

  // Fetch campaign details
  useEffect(() => {
    if (!campaignId || typeof campaignId !== 'string') {
      setLoading(false);
      return;
    }

    if (pinRequired) {
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

        const data = await authenticatedFetch(`${API_BASE}/api/campaigns`);
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
  }, [campaignId, API_BASE, mockMode, pinRequired]);

  if (pinRequired) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 w-full max-w-sm">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Enter Dashboard PIN</h1>
          <p className="text-sm text-gray-600 mb-4">Temporary access for MVP testing.</p>
          <input
            type="password"
            value={pinInput}
            onChange={(e) => {
              setPinInput(e.target.value);
              setPinError(null);
            }}
            className="w-full border border-gray-300 rounded-md px-3 py-2 mb-3"
            placeholder="PIN"
          />
          {pinError && <div className="text-sm text-red-600 mb-3">{pinError}</div>}
          <button
            onClick={() => {
              if (!pinInput.trim()) {
                setPinError('PIN is required');
                return;
              }
              localStorage.setItem('dashboard_pin', pinInput.trim());
              setPinRequired(false);
            }}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

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
                  try {
                    const data = await authenticatedFetch(`${API_BASE}/batch/start/${campaignId}`, {
                      method: 'POST',
                      body: JSON.stringify({
                        cooldownHours: 24,
                        maxRetries: 2,
                      }),
                    });
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
                      alert('PIN required. Please enter the dashboard PIN.');
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
