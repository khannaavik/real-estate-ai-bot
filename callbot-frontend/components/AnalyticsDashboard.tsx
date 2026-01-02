// components/AnalyticsDashboard.tsx
import React, { useEffect, useState } from 'react';
import { useLiveEvents, type SSEEvent } from '../hooks/useLiveEvents';
import { getOutcomeBucketLabel } from '../utils/labelHelpers';

interface AnalyticsDashboardProps {
  campaignId: string;
  campaignName?: string;
  mockMode?: boolean;
}

interface KPIs {
  totalCalls: number;
  hotLeads: number;
  conversionRate: number;
  avgCallDuration: number;
}

interface FunnelData {
  NOT_PICK: number;
  COLD: number;
  WARM: number;
  HOT: number;
  CONVERTED: number;
}

interface BatchJob {
  id: string;
  status: string;
  currentIndex: number;
  totalLeads: number;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

interface AILearningInsight {
  id: string;
  scriptVariant: string | null;
  voiceTone: string | null;
  emotion: string | null;
  urgencyLevel: string | null;
  objections: string[];
  outcomeBucket: string | null;
  converted: boolean;
  createdAt: string;
}

interface RecentActivity {
  type: string;
  timestamp: string;
  message: string;
}

export function AnalyticsDashboard({ campaignId, campaignName, mockMode = false }: AnalyticsDashboardProps) {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [batchPerformance, setBatchPerformance] = useState<BatchJob[]>([]);
  const [aiInsights, setAiInsights] = useState<AILearningInsight[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

  // Fetch analytics data
  useEffect(() => {
    if (mockMode) {
      // Mock data for testing
      setKpis({
        totalCalls: 150,
        hotLeads: 12,
        conversionRate: 8.5,
        avgCallDuration: 180,
      });
      setFunnel({
        NOT_PICK: 45,
        COLD: 30,
        WARM: 25,
        HOT: 12,
        CONVERTED: 8,
      });
      setBatchPerformance([
        {
          id: 'mock-1',
          status: 'COMPLETED',
          currentIndex: 100,
          totalLeads: 100,
          startedAt: new Date(Date.now() - 3600000).toISOString(),
          completedAt: new Date(Date.now() - 1800000).toISOString(),
          cancelledAt: null,
          createdAt: new Date(Date.now() - 3600000).toISOString(),
        },
      ]);
      setAiInsights([
        {
          id: 'mock-1',
          scriptVariant: 'DISCOVERY_SOFT',
          voiceTone: 'empathetic',
          emotion: 'calm',
          urgencyLevel: 'medium',
          objections: ['PRICE'],
          outcomeBucket: 'HIGH',
          converted: true,
          createdAt: new Date().toISOString(),
        },
      ]);
      setLoading(false);
      return;
    }

    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/analytics/overview/${campaignId}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();
        if (data.ok) {
          setKpis(data.kpis);
          setFunnel(data.funnel);
          setBatchPerformance(data.batchPerformance || []);
          setAiInsights(data.aiLearningInsights || []);
        } else {
          throw new Error(data.error || 'Failed to load analytics');
        }
      } catch (err: any) {
        console.error('Failed to fetch analytics:', err);
        setError(err?.message || 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [campaignId, API_BASE, mockMode]);

  // Handle live events for recent activity feed
  const handleLiveEvent = React.useCallback((event: SSEEvent) => {
    if (mockMode) return;

    const activityMessage = (() => {
      switch (event.type) {
        case 'CALL_STARTED':
          return `Call started for lead ${event.campaignContactId?.substring(0, 8)}...`;
        case 'CALL_ENDED':
          return `Call ended for lead ${event.campaignContactId?.substring(0, 8)}...`;
        case 'LEAD_UPDATED':
          return `Lead status updated to ${event.data.status}`;
        case 'BATCH_STARTED':
          return `Batch job started: ${event.data.totalLeads} leads`;
        case 'BATCH_COMPLETED':
          return `Batch job completed`;
        case 'BATCH_PAUSED':
          return `Batch job paused`;
        case 'BATCH_RESUMED':
          return `Batch job resumed`;
        case 'CALL_OUTCOME_PREDICTED':
          return `Outcome predicted: ${event.data.bucket}`;
        default:
          return `${event.type} event`;
      }
    })();

    setRecentActivity((prev) => [
      {
        type: event.type,
        timestamp: new Date().toISOString(),
        message: activityMessage,
      },
      ...prev.slice(0, 19), // Keep last 20 items
    ]);
  }, [mockMode]);

  const { isConnected } = useLiveEvents({
    apiBase: API_BASE,
    onEvent: handleLiveEvent,
    mockMode: mockMode,
  });

  // Calculate funnel percentages for visualization
  const getFunnelPercentage = (value: number, max: number) => {
    if (max === 0) return 0;
    return Math.min(100, (value / max) * 100);
  };

  const maxFunnelValue = funnel
    ? Math.max(
        funnel.NOT_PICK,
        funnel.COLD,
        funnel.WARM,
        funnel.HOT,
        funnel.CONVERTED
      )
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">Loading analytics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-red-600">Error: {error}</div>
      </div>
    );
  }

  // STEP 21: State for showing detailed analytics
  const [showDetailedAnalytics, setShowDetailedAnalytics] = useState(false);

  // STEP 21: Calculate insights from data
  const bestTimeToCall = '10 AM - 12 PM'; // Mock - would calculate from call logs
  const topConvertingMessage = aiInsights.length > 0 
    ? `${aiInsights[0]?.scriptVariant || 'Discovery'} with ${aiInsights[0]?.voiceTone || 'empathetic'} tone`
    : 'Not enough data';
  const mostCommonObjection = aiInsights.length > 0 && aiInsights[0]?.objections?.length > 0
    ? aiInsights[0].objections[0]
    : 'None detected';
  const hotLeadsToday = funnel?.HOT || 0;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Analytics & Insights</h1>
        {campaignName && (
          <p className="text-sm text-gray-600 mt-1">Campaign: {campaignName}</p>
        )}
      </div>

      {/* STEP 21: Insight Cards (Default View) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border border-blue-200 p-5 shadow-sm">
          <div className="text-sm text-blue-700 font-medium mb-1">Best Time to Call</div>
          <div className="text-2xl font-bold text-blue-900">{bestTimeToCall}</div>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg border border-green-200 p-5 shadow-sm">
          <div className="text-sm text-green-700 font-medium mb-1">Top Converting Message</div>
          <div className="text-sm font-semibold text-green-900">{topConvertingMessage}</div>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-lg border border-amber-200 p-5 shadow-sm">
          <div className="text-sm text-amber-700 font-medium mb-1">Most Common Objection</div>
          <div className="text-sm font-semibold text-amber-900">{mostCommonObjection}</div>
        </div>
        <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg border border-red-200 p-5 shadow-sm">
          <div className="text-sm text-red-700 font-medium mb-1">Hot Leads Today</div>
          <div className="text-3xl font-bold text-red-900">{hotLeadsToday}</div>
        </div>
      </div>

      {/* STEP 21: Toggle for Detailed Analytics */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Detailed Analytics</h2>
        <button
          onClick={() => setShowDetailedAnalytics(!showDetailedAnalytics)}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded hover:bg-gray-200 transition-colors"
        >
          {showDetailedAnalytics ? 'Hide' : 'View Detailed Analytics'}
        </button>
      </div>

      {showDetailedAnalytics && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <div className="text-sm text-gray-600 mb-1">Total Calls</div>
              <div className="text-3xl font-bold text-gray-900">{kpis?.totalCalls || 0}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <div className="text-sm text-gray-600 mb-1">HOT Leads</div>
              <div className="text-3xl font-bold text-red-600">{kpis?.hotLeads || 0}</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <div className="text-sm text-gray-600 mb-1">Conversion Rate</div>
              <div className="text-3xl font-bold text-green-600">{kpis?.conversionRate || 0}%</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
              <div className="text-sm text-gray-600 mb-1">Avg Call Duration</div>
              <div className="text-3xl font-bold text-blue-600">
                {kpis?.avgCallDuration ? `${Math.floor(kpis.avgCallDuration / 60)}m ${kpis.avgCallDuration % 60}s` : '0s'}
              </div>
            </div>
          </div>

          {/* Funnel Visualization */}
          {funnel && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Lead Funnel</h2>
          <div className="space-y-4">
            {[
              { label: 'NOT_PICK', value: funnel.NOT_PICK, color: 'bg-gray-500' },
              { label: 'COLD', value: funnel.COLD, color: 'bg-blue-500' },
              { label: 'WARM', value: funnel.WARM, color: 'bg-yellow-500' },
              { label: 'HOT', value: funnel.HOT, color: 'bg-orange-500' },
              { label: 'CONVERTED', value: funnel.CONVERTED, color: 'bg-green-500' },
            ].map((stage) => {
              const percentage = getFunnelPercentage(stage.value, maxFunnelValue);
              return (
                <div key={stage.label} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">{stage.label}</span>
                    <span className="text-gray-600">{stage.value}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-6 overflow-hidden">
                    <div
                      className={`${stage.color} h-full transition-all duration-500 flex items-center justify-end pr-2`}
                      style={{ width: `${percentage}%` }}
                    >
                      {percentage > 10 && (
                        <span className="text-xs text-white font-medium">{Math.round(percentage)}%</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        )}

        {/* Two Column Layout for remaining sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Batch Performance */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Batch Performance</h2>
          {batchPerformance.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-3 text-gray-700 font-medium">Status</th>
                    <th className="text-left py-2 px-3 text-gray-700 font-medium">Progress</th>
                    <th className="text-left py-2 px-3 text-gray-700 font-medium">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {batchPerformance.map((job) => {
                    const progress = job.totalLeads > 0 ? Math.round((job.currentIndex / job.totalLeads) * 100) : 0;
                    const statusColor =
                      job.status === 'COMPLETED'
                        ? 'bg-green-100 text-green-700'
                        : job.status === 'RUNNING'
                        ? 'bg-blue-100 text-blue-700'
                        : job.status === 'PAUSED'
                        ? 'bg-yellow-100 text-yellow-700'
                        : job.status === 'CANCELLED'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-700';
                    return (
                      <tr key={job.id} className="border-b border-gray-100">
                        <td className="py-2 px-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${statusColor}`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-gray-600">
                          {job.currentIndex}/{job.totalLeads} ({progress}%)
                        </td>
                        <td className="py-2 px-3 text-gray-600">
                          {job.startedAt
                            ? new Date(job.startedAt).toLocaleDateString()
                            : new Date(job.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-gray-500 text-center py-8">No batch jobs yet</div>
          )}
        </div>

        {/* AI Learning Insights */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">AI Learning Insights</h2>
          {aiInsights.length > 0 ? (
            <div className="space-y-4">
              {aiInsights.map((insight, index) => (
                <div key={insight.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500">Pattern #{index + 1}</span>
                    <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                      Converted
                    </span>
                  </div>
                  <div className="space-y-2 text-sm">
                    {insight.scriptVariant && (
                      <div>
                        <span className="text-gray-600">Script:</span>{' '}
                        <span className="font-medium text-gray-900">{insight.scriptVariant}</span>
                      </div>
                    )}
                    {insight.voiceTone && (
                      <div>
                        <span className="text-gray-600">Tone:</span>{' '}
                        <span className="font-medium text-gray-900">{insight.voiceTone}</span>
                      </div>
                    )}
                    {insight.emotion && (
                      <div>
                        <span className="text-gray-600">Emotion:</span>{' '}
                        <span className="font-medium text-gray-900">{insight.emotion}</span>
                      </div>
                    )}
                    {insight.objections.length > 0 && (
                      <div>
                        <span className="text-gray-600">Objections:</span>{' '}
                        <span className="font-medium text-gray-900">{insight.objections.join(', ')}</span>
                      </div>
                    )}
                    {insight.outcomeBucket && (
                      <div>
                        <span className="text-gray-600">Outcome:</span>{' '}
                        <span className="font-medium text-gray-900">{getOutcomeBucketLabel(insight.outcomeBucket)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 text-center py-8">No learning insights yet</div>
          )}
          </div>
        </div>
        </>
      )}

      {/* Recent Activity Feed - Always visible */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent Activity</h2>
          {isConnected && !mockMode && (
            <span className="flex items-center gap-2 px-2 py-1 bg-green-100 text-green-700 rounded-md text-xs font-medium">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              Live
            </span>
          )}
        </div>
        {recentActivity.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {recentActivity.map((activity, index) => (
              <div key={index} className="flex items-start gap-3 text-sm border-b border-gray-100 pb-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0"></div>
                <div className="flex-1 min-w-0">
                  <div className="text-gray-900">{activity.message}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {new Date(activity.timestamp).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500 text-center py-8">
            {mockMode ? 'Activity feed available in live mode' : 'No recent activity'}
          </div>
        )}
      </div>
    </div>
  );
}
