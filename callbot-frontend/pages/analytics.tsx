import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { authenticatedFetch, getApiBaseUrl } from "../utils/api";

type AnalyticsOverview = {
  totalCalls: number;
  pickedCalls: number;
  noAnswerCalls: number;
  interestBreakdown: {
    cold: number;
    warm: number;
    hot: number;
  };
  topCampaigns: { campaignName: string; hotLeads: number }[];
  pendingFollowUps: number;
};

export default function AnalyticsPage() {
  const router = useRouter();
  const API_BASE = getApiBaseUrl();
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinRequired, setPinRequired] = useState(true);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    const savedPin = localStorage.getItem("dashboard_pin");
    if (savedPin) {
      setPinRequired(false);
    }
  }, []);

  useEffect(() => {
    if (pinRequired) {
      setLoading(false);
      return;
    }

    const fetchOverview = async () => {
      try {
        setLoading(true);
        const data = await authenticatedFetch(`${API_BASE}/api/analytics/overview`);
        setOverview(data as AnalyticsOverview);
        setError(null);
      } catch (err: any) {
        console.error("Failed to fetch analytics overview:", err);
        const message = err?.message || "Failed to load analytics";
        if (message.includes("401") || message.includes("Authentication required")) {
          setError("PIN required. Please enter the dashboard PIN.");
        } else {
          setError(message);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchOverview();
  }, [API_BASE, pinRequired]);

  const pickedRate = useMemo(() => {
    if (!overview || overview.totalCalls === 0) return 0;
    return Math.round((overview.pickedCalls / overview.totalCalls) * 100);
  }, [overview]);

  const interestTotal = useMemo(() => {
    if (!overview) return 0;
    return (
      overview.interestBreakdown.cold +
      overview.interestBreakdown.warm +
      overview.interestBreakdown.hot
    );
  }, [overview]);

  const interestItems = useMemo(
    () => [
      { label: "Cold", value: overview?.interestBreakdown.cold || 0, color: "bg-slate-300" },
      { label: "Warm", value: overview?.interestBreakdown.warm || 0, color: "bg-amber-400" },
      { label: "Hot", value: overview?.interestBreakdown.hot || 0, color: "bg-rose-500" },
    ],
    [overview]
  );

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
                setPinError("PIN is required");
                return;
              }
              localStorage.setItem("dashboard_pin", pinInput.trim());
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
        <div className="w-full max-w-[1200px] px-6 py-10 space-y-6 animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-48" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={`kpi-skeleton-${idx}`} className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm space-y-3">
                <div className="h-3 bg-gray-200 rounded w-24" />
                <div className="h-8 bg-gray-200 rounded w-20" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6">
            <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm space-y-4">
              <div className="h-4 bg-gray-200 rounded w-40" />
              <div className="h-2 bg-gray-200 rounded w-full" />
              <div className="h-2 bg-gray-200 rounded w-full" />
              <div className="h-2 bg-gray-200 rounded w-full" />
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm space-y-4">
              <div className="h-4 bg-gray-200 rounded w-32" />
              <div className="h-3 bg-gray-200 rounded w-full" />
              <div className="h-3 bg-gray-200 rounded w-full" />
              <div className="h-3 bg-gray-200 rounded w-full" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-red-600">Error: {error}</div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-gray-500">No analytics data available.</div>
      </div>
    );
  }

  const isEmpty =
    overview.totalCalls === 0 &&
    overview.topCampaigns.length === 0 &&
    overview.pendingFollowUps === 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1200px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/")}
                className="text-gray-600 hover:text-gray-900 transition-colors"
                aria-label="Back to home"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
              <div>
                <h1 className="text-xl font-semibold text-gray-900">Analytics Overview</h1>
                <p className="text-sm text-gray-600">Real-time summary of completed calls</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="font-medium">Pending follow-ups</span>
              <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 border border-blue-100">
                {overview.pendingFollowUps}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-6 py-8 space-y-8">
        {isEmpty && (
          <div className="bg-white border border-dashed border-gray-200 rounded-lg p-6 text-center text-gray-600">
            No completed calls yet. Start calling to populate analytics.
          </div>
        )}

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <div className="text-sm text-gray-500">Total Calls</div>
            <div className="text-3xl font-semibold text-gray-900 mt-2">{overview.totalCalls}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <div className="text-sm text-gray-500">Picked %</div>
            <div className="text-3xl font-semibold text-gray-900 mt-2">{pickedRate}%</div>
            <div className="text-xs text-gray-500 mt-1">
              {overview.pickedCalls} picked / {overview.totalCalls} completed
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <div className="text-sm text-gray-500">Hot Leads</div>
            <div className="text-3xl font-semibold text-gray-900 mt-2">
              {overview.interestBreakdown.hot}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">Interest Breakdown</h2>
              <div className="text-xs text-gray-500">{interestTotal} total</div>
            </div>
            <div className="space-y-3">
              {interestItems.map((item) => {
                const percent = interestTotal === 0 ? 0 : Math.round((item.value / interestTotal) * 100);
                return (
                  <div key={item.label}>
                    <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
                      <span>{item.label}</span>
                      <span>{item.value} ({percent}%)</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`${item.color} h-full rounded-full transition-all`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Top Campaigns</h2>
            {overview.topCampaigns.length === 0 ? (
              <div className="text-sm text-gray-500">No hot leads yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-4 font-semibold">Campaign Name</th>
                      <th className="py-2 font-semibold text-right">Hot Leads</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {overview.topCampaigns.map((campaign) => (
                      <tr key={`${campaign.campaignName}-${campaign.hotLeads}`}>
                        <td className="py-3 pr-4 text-gray-700 max-w-[220px] truncate">
                          {campaign.campaignName}
                        </td>
                        <td className="py-3 text-right font-semibold text-gray-900">
                          {campaign.hotLeads}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
