/**
 * Job Status Toast Component
 *
 * Displays real-time job status updates as a draggable toast notification.
 * Includes "nerd mode" — an expandable terminal panel showing live FireSTARR
 * engine output, searchable after completion.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Rnd } from 'react-rnd';
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

const TOAST_WIDTH = 380;
const NERD_WIDTH = 520;
const TOAST_MARGIN = 20;

/**
 * Resizable from the bottom-right corner (#408).
 *
 * This panel is the only window onto a running model, and at a fixed size
 * FireSTARR's NOTE: output and failure messages are cut off — the part that
 * does not fit is usually the part that matters.
 *
 * Only the bottom-right corner. The panel is anchored to the bottom-right of
 * the viewport, so a top or left handle grows it by moving the opposite edge
 * off screen, which is worse than not resizing at all.
 */
const MIN_WIDTH = 320;
const MIN_HEIGHT = 120;
const SIZE_STORAGE_KEY = 'nomad.jobStatusToast.size';

interface StoredSize {
  width: number;
  height: number;
}

/**
 * localStorage is per-viewer and can hold anything — a half-written value, a
 * different app's key, a browser that throws on access in private mode. A
 * panel that dies here takes the only view of a running model with it, so a
 * bad value is treated as "no preference" rather than an error.
 */
function readStoredSize(): StoredSize | null {
  try {
    const raw = localStorage.getItem(SIZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSize>;
    if (typeof parsed?.width !== 'number' || typeof parsed?.height !== 'number') return null;
    if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return null;
    return {
      width: Math.max(parsed.width, MIN_WIDTH),
      height: Math.max(parsed.height, MIN_HEIGHT),
    };
  } catch {
    return null;
  }
}

function writeStoredSize(size: StoredSize): void {
  try {
    localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size));
  } catch {
    // Storage full or blocked. The size is still applied for this session;
    // losing the preference is not worth interrupting a run over.
  }
}

export function JobStatusToast({
  status,
  onDismiss,
  onViewResults,
}: JobStatusToastProps): React.ReactElement | null {
  const [nerdMode, setNerdMode] = useState(false);
  const [liveSize, setLiveSize] = useState<StoredSize | null>(() => readStoredSize());
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logFilter, setLogFilter] = useState('');
  const logScrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const eventSourceRef = useRef<EventSource | null>(null);

  const isTerminal = status ? ['completed', 'failed', 'cancelled'].includes(status.status) : false;
  const jobId = status?.id ?? null;

  // Connect/disconnect log stream based on nerd mode
  useEffect(() => {
    if (!nerdMode || !jobId) {
      // Close connection when nerd mode is off
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    // Open log stream
    const es = new EventSource(`/api/v1/jobs/${jobId}/log-stream`);
    eventSourceRef.current = es;

    es.addEventListener('log', (event) => {
      try {
        const data = JSON.parse(event.data) as { line: string };
        setLogLines((prev) => [...prev, data.line]);
      } catch {
        // Ignore malformed events
      }
    });

    es.addEventListener('complete', () => {
      es.close();
      eventSourceRef.current = null;
    });

    es.onerror = () => {
      // SSE auto-reconnects; don't close manually
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [nerdMode, jobId]);

  // Clear log lines when status clears (toast dismissed)
  useEffect(() => {
    if (!status) {
      setLogLines([]);
      setNerdMode(false);
      setLogFilter('');
    }
  }, [status]);

  // Auto-scroll to bottom during execution
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el || !nerdMode || !status) return;

    if (!isTerminal && wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logLines, nerdMode, isTerminal, status]);

  // Track whether user has scrolled away from bottom
  const handleLogScroll = () => {
    const el = logScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    wasAtBottomRef.current = atBottom;
  };

  if (!status) return null;

  const color = statusColors[status.status];
  const currentWidth = nerdMode ? NERD_WIDTH : TOAST_WIDTH;

  const filteredLines = logFilter
    ? logLines.filter((line) => line.toLowerCase().includes(logFilter.toLowerCase()))
    : logLines;

  return (
    <Rnd
      default={{
        x: window.innerWidth - (liveSize?.width ?? currentWidth) - TOAST_MARGIN,
        y: window.innerHeight - 160,
        width: liveSize?.width ?? currentWidth,
        height: liveSize?.height ?? ('auto' as unknown as number),
      }}
      size={{
        width: liveSize?.width ?? currentWidth,
        height: liveSize?.height ?? ('auto' as unknown as number),
      }}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      // Corner only — see MIN_WIDTH above for why the top and left edges are off.
      enableResizing={{
        top: false,
        right: false,
        bottom: false,
        left: false,
        topRight: false,
        bottomRight: true,
        bottomLeft: false,
        topLeft: false,
      }}
      // Tracked DURING the drag, not only at the end.
      //
      // `size` is a controlled prop, so whatever it says is the size — if it
      // only updated on resizeStop the panel would not follow the pointer and
      // the handle would feel dead, which is exactly how it behaved when this
      // was written stop-only. Found by dragging it, not by running the tests:
      // every unit test passed against the stop-only version.
      onResize={(_e, _dir, ref) => {
        setLiveSize({
          width: Math.max(ref.offsetWidth, MIN_WIDTH),
          height: Math.max(ref.offsetHeight, MIN_HEIGHT),
        });
      }}
      onResizeStop={(_e, _dir, ref) => {
        const next = {
          width: Math.max(ref.offsetWidth, MIN_WIDTH),
          height: Math.max(ref.offsetHeight, MIN_HEIGHT),
        };
        setLiveSize(next);
        writeStoredSize(next);
      }}
      dragHandleClassName="toast-drag-handle"
      bounds="window"
      style={{ zIndex: 9999, position: 'fixed' }}
    >
      <div
        style={{
          backgroundColor: '#1f2937',
          border: `2px solid ${color}`,
          borderRadius: '8px',
          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)',
          color: '#f3f4f6',
          fontFamily: 'system-ui, sans-serif',
          overflow: 'hidden',
          // Fill the Rnd frame once a size has been chosen, so dragging the
          // corner actually changes what you see. Without this the frame
          // resizes and the panel does not — which looks exactly like a broken
          // handle, and would have passed every unit test above.
          width: '100%',
          height: liveSize ? '100%' : 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header — drag handle */}
        <div
          className="toast-drag-handle"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '16px',
            cursor: 'grab',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: color,
                  animation: status.status === 'running' ? 'toast-pulse 2s infinite' : undefined,
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
                    animation: 'toast-spin 1s linear infinite',
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

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginLeft: '8px' }}>
            {/* Nerd mode toggle */}
            <button
              onClick={() => setNerdMode((prev) => !prev)}
              title={nerdMode ? 'Hide log' : 'Show log'}
              style={{
                background: nerdMode ? '#374151' : 'none',
                border: nerdMode ? '1px solid #4b5563' : 'none',
                color: nerdMode ? '#10b981' : '#6b7280',
                cursor: 'pointer',
                padding: '4px 6px',
                lineHeight: 1,
                fontFamily: 'monospace',
                fontSize: '13px',
                fontWeight: 700,
                borderRadius: '3px',
              }}
            >
              {'>_'}
            </button>

            {/* Dismiss (× button for active jobs) */}
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
        </div>

        {/* Nerd Mode Terminal Panel */}
        {nerdMode && (
          <div
            style={{
              borderTop: '1px solid #374151',
              // The log below is sized as a FLEX ITEM ({ flex: 1, minHeight: 0 }),
              // and that does nothing unless its parent is a flex container.
              // While this wrapper was a plain block the log grew to its full
              // content height — 33,238px during a live run — the wrapper grew
              // with it, and the outer column clipped the overflow with no
              // scrollbar anywhere. Only reproduces once a size is stored, which
              // is why it shipped (#408).
              ...(liveSize
                ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' as const }
                : {}),
            }}
          >
            {/* Search bar (only shown after completion) */}
            {isTerminal && (
              <div style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>
                <input
                  type="text"
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                  placeholder="Filter logs..."
                  style={{
                    width: '100%',
                    backgroundColor: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '4px',
                    color: '#e6edf3',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    padding: '4px 8px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {/* Log output */}
            <div
              ref={logScrollRef}
              onScroll={handleLogScroll}
              style={{
                // Fixed until the operator resizes, then it takes the slack.
                // The log is the reason to make this panel bigger, so it is
                // the part that must grow.
                ...(liveSize
                  ? { flex: 1, minHeight: 0 }
                  : { height: '200px' }),
                overflowY: 'auto',
                backgroundColor: '#0d1117',
                fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
                fontSize: '11px',
                padding: '8px',
                color: '#e6edf3',
                lineHeight: 1.5,
              }}
            >
              {filteredLines.length === 0 ? (
                <div style={{ color: '#484f58', fontStyle: 'italic' }}>
                  {logFilter ? 'No matching log lines' : 'Waiting for output...'}
                </div>
              ) : (
                filteredLines.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      padding: '1px 0',
                    }}
                  >
                    {line}
                  </div>
                ))
              )}
            </div>

            {/* Line count footer */}
            <div
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                color: '#484f58',
                borderTop: '1px solid #21262d',
                backgroundColor: '#0d1117',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>
                {logFilter
                  ? `${filteredLines.length} / ${logLines.length} lines`
                  : `${logLines.length} lines`}
              </span>
              {!isTerminal && <span style={{ color: '#f59e0b' }}>LIVE</span>}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes toast-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes toast-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </Rnd>
  );
}

export default JobStatusToast;
