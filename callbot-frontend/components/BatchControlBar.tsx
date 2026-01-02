// components/BatchControlBar.tsx
import React, { useState } from 'react';

export type BatchStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | null;

export interface BatchJob {
  batchJobId: string | null;
  status: BatchStatus;
  currentIndex: number;
  totalLeads: number;
  pausedAt?: string | null;
}

interface BatchControlBarProps {
  batchJob: BatchJob | null;
  isLoading: boolean;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onStop: () => Promise<void>;
  mockMode?: boolean;
}

export function BatchControlBar({
  batchJob,
  isLoading,
  onPause,
  onResume,
  onStop,
  mockMode = false,
}: BatchControlBarProps) {
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  // Don't render if no active batch job
  if (!batchJob || batchJob.status === null) {
    return null;
  }

  // Don't show for completed or cancelled batches
  if (batchJob.status === 'COMPLETED' || batchJob.status === 'CANCELLED') {
    return null;
  }

  const progressPercent = batchJob.totalLeads > 0 
    ? (batchJob.currentIndex / batchJob.totalLeads) * 100 
    : 0;

  const getStatusColor = (status: BatchStatus) => {
    switch (status) {
      case 'RUNNING':
        return 'bg-green-500';
      case 'PAUSED':
        return 'bg-yellow-500';
      case 'COMPLETED':
        return 'bg-gray-500';
      case 'CANCELLED':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  const getStatusText = (status: BatchStatus) => {
    switch (status) {
      case 'RUNNING':
        return 'RUNNING';
      case 'PAUSED':
        return 'PAUSED';
      case 'COMPLETED':
        return 'COMPLETED';
      case 'CANCELLED':
        return 'CANCELLED';
      default:
        return 'UNKNOWN';
    }
  };

  return (
    <>
      {/* STEP 21: Light neutral surface with subtle border and shadow */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-50 border-t border-gray-300 shadow-sm z-40">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Left: Status (emphasized) */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${
                batchJob.status === 'RUNNING' ? 'bg-green-100 text-green-800' :
                batchJob.status === 'PAUSED' ? 'bg-yellow-100 text-yellow-800' :
                'bg-gray-100 text-gray-700'
              }`}>
                <span className={`w-2 h-2 rounded-full ${getStatusColor(batchJob.status)}`}></span>
                {getStatusText(batchJob.status)}
              </span>

              <span className="text-sm text-gray-600">
                {batchJob.currentIndex} of {batchJob.totalLeads} leads
              </span>
            </div>

            {/* Right: Control Buttons (minimal and calm) */}
            <div className="flex items-center gap-2">
              {batchJob.status === 'RUNNING' && (
                <button
                  onClick={onPause}
                  disabled={isLoading || mockMode}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Pause batch calling"
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Pausing...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Pause
                    </>
                  )}
                </button>
              )}

              {batchJob.status === 'PAUSED' && (
                <button
                  onClick={onResume}
                  disabled={isLoading || mockMode}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Resume batch calling"
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Resuming...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                      </svg>
                      Resume
                    </>
                  )}
                </button>
              )}

              <button
                onClick={() => setShowStopConfirm(true)}
                disabled={isLoading || mockMode}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-300 text-red-700 text-sm font-medium rounded hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Stop batch calling (irreversible)"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                </svg>
                Stop
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stop Confirmation Modal */}
      {showStopConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-2 text-red-600">Stop Batch Job?</h3>
            <p className="text-sm text-gray-700 mb-4">
              This will immediately stop the batch calling process. This action cannot be undone.
              <br />
              <span className="font-medium">Progress: {batchJob.currentIndex} of {batchJob.totalLeads} leads processed.</span>
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300"
                onClick={() => setShowStopConfirm(false)}
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded hover:bg-red-700 disabled:opacity-50"
                onClick={async () => {
                  setShowStopConfirm(false);
                  await onStop();
                }}
                disabled={isLoading}
              >
                {isLoading ? 'Stopping...' : 'Stop Batch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
