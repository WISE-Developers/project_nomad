/**
 * Job Status Toast Component
 *
 * Displays real-time job status updates as a toast notification.
 */

import React from 'react';
import type { JobStatus } from '../hooks/useJobNotifications';

interface JobStatusToastProps {
  status: JobStatus | null;
  onDismiss?: () => void;
  onViewResults?: () => void;
}

const statusColors = {
  pending: '#6b7280',
  running: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  cancelled: '#6b7280',
};

const statusText = {
  pending: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function JobStatusToast({
  status,
  onDismiss,
  onViewResults,
}: JobStatusToastProps): React.ReactElement | null {
  if (!status) return null;

  const isTerminal = ['completed', 'failed', 'cancelled'].includes(status.status);
  const color = statusColors[status.status];

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        backgroundColor: '#1f2937',
        border: `2px solid ${color}`,
        borderRadius: '8px',
        padding: '16px',
        minWidth: '300px',
        maxWidth: '400px',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)',
        zIndex: 9999,
        color: '#f3f4f6',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: color,
                animation: status.status === 'running' ? 'pulse 2s infinite' : undefined,
              }}
            />
            <span style={{ fontWeight: 600, fontSize: '14px' }}>
              Model Execution: {statusText[status.status]}
            </span>
          </div>

          {status.status === 'running' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  border: '2px solid #374151',
                  borderTop: '2px solid #f59e0b',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  flexShrink: 0,
                }}
              />
              <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                Processing fire model...
              </div>
            </div>
          )}

          {status.error && (
            <div style={{ fontSize: '13px', color: '#f87171', marginTop: '4px' }}>
              {status.error}
            </div>
          )}

          {isTerminal && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              {status.status === 'completed' && onViewResults && (
                <button
                  onClick={onViewResults}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                  }}
                >
                  View Results
                </button>
              )}
              <button
                onClick={onDismiss}
                style={{
                  padding: '6px 12px',
                  backgroundColor: 'transparent',
                  color: '#9ca3af',
                  border: '1px solid #4b5563',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {!isTerminal && (
          <button
            onClick={onDismiss}
            style={{
              background: 'none',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              padding: '4px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default JobStatusToast;
