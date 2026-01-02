// components/LeadDetailDrawer.tsx
import React from 'react';
import { LeadStatusBadge, type LeadStatus } from './LeadStatusBadge';

interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
}

interface CallHistoryItem {
  id: string;
  callSid?: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  status?: LeadStatus;
  transcript?: string;
}

interface LeadDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  contact?: Contact;
  campaignContactId?: string;
  status: LeadStatus | string;
  lastCallAt?: string | null;
  callHistory?: CallHistoryItem[];
  mockMode?: boolean;
  onStatusChange?: (newStatus: LeadStatus) => void;
  onStartCall?: () => void;
}

export function LeadDetailDrawer({
  isOpen,
  onClose,
  contact,
  campaignContactId,
  status,
  lastCallAt,
  callHistory = [],
  mockMode = false,
  onStatusChange,
  onStartCall,
}: LeadDetailDrawerProps) {
  // Mock call history for demo
  const mockCallHistory: CallHistoryItem[] = [
    {
      id: 'mock-call-1',
      callSid: 'CA1234567890',
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      endedAt: new Date(Date.now() - 3300000).toISOString(),
      durationSeconds: 300,
      status: 'WARM',
      transcript: 'Customer showed interest in 2BHK property. Asked about location and pricing.',
    },
    {
      id: 'mock-call-2',
      callSid: 'CA0987654321',
      startedAt: new Date(Date.now() - 86400000).toISOString(),
      endedAt: new Date(Date.now() - 86100000).toISOString(),
      durationSeconds: 300,
      status: 'COLD',
      transcript: 'Initial contact. Customer requested more information via email.',
    },
  ];

  const displayCallHistory = mockMode ? mockCallHistory : callHistory;

  const handleStatusChange = (newStatus: LeadStatus) => {
    if (onStatusChange) {
      onStatusChange(newStatus);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black z-40 transition-opacity duration-300 ${
          isOpen ? 'bg-opacity-50 opacity-100' : 'bg-opacity-0 opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-xl z-50 transform transition-transform duration-300 ease-in-out overflow-y-auto ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal={isOpen}
        aria-labelledby="drawer-title"
        aria-hidden={!isOpen}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 id="drawer-title" className="text-xl font-semibold">
              Lead Details
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-md transition-colors"
              aria-label="Close drawer"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
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

          {/* Contact Information */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 mb-3">Contact Information</h3>
            <div className="space-y-2">
              <div>
                <span className="text-xs text-gray-500">Name</span>
                <p className="text-base font-medium">{contact?.name || 'Unknown'}</p>
              </div>
              <div>
                <span className="text-xs text-gray-500">Phone</span>
                <p className="text-base">{contact?.phone || '-'}</p>
              </div>
              {contact?.email && (
                <div>
                  <span className="text-xs text-gray-500">Email</span>
                  <p className="text-base">{contact.email}</p>
                </div>
              )}
              <div>
                <span className="text-xs text-gray-500">Campaign Contact ID</span>
                <p className="text-base font-mono text-xs text-gray-600">{campaignContactId || '-'}</p>
              </div>
            </div>
          </div>

          {/* Current Status */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 mb-3">Current Status</h3>
            <div className="flex items-center gap-3 mb-4">
              <LeadStatusBadge status={status} />
              {lastCallAt && (
                <span className="text-xs text-gray-500">
                  Last call: {new Date(lastCallAt).toLocaleString()}
                </span>
              )}
            </div>

            {/* Status Controls */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-700 mb-2">
                Change Status:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['NOT_PICK', 'COLD', 'WARM', 'HOT'] as LeadStatus[]).map((statusOption) => (
                  <button
                    key={statusOption}
                    onClick={() => handleStatusChange(statusOption)}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      status === statusOption
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    aria-label={`Set status to ${statusOption}`}
                  >
                    {statusOption === 'NOT_PICK' ? 'Not Pick' : statusOption}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-500 mb-3">Actions</h3>
            <div className="space-y-2">
              {onStartCall && (
                <button
                  onClick={onStartCall}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 transition-colors"
                >
                  {mockMode ? '(Mock) Start Call' : 'Start Call'}
                </button>
              )}
            </div>
          </div>

          {/* Call History */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-3">
              Call History ({displayCallHistory.length})
            </h3>
            {displayCallHistory.length === 0 ? (
              <p className="text-sm text-gray-500">No call history available</p>
            ) : (
              <div className="space-y-4">
                {displayCallHistory.map((call) => (
                  <div
                    key={call.id}
                    className="p-4 bg-gray-50 rounded-md border border-gray-200"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {call.status && <LeadStatusBadge status={call.status} />}
                        <span className="text-xs text-gray-500">
                          {new Date(call.startedAt).toLocaleString()}
                        </span>
                      </div>
                      {call.durationSeconds && (
                        <span className="text-xs text-gray-500">
                          {Math.floor(call.durationSeconds / 60)}m {call.durationSeconds % 60}s
                        </span>
                      )}
                    </div>
                    {call.callSid && (
                      <p className="text-xs text-gray-500 font-mono mb-2">
                        SID: {call.callSid}
                      </p>
                    )}
                    {call.transcript && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-500 mb-1">Transcript:</p>
                        <p className="text-sm text-gray-700">{call.transcript}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

