/**
 * Results Summary Component
 *
 * Displays execution summary including status, progress, and timing info.
 */

import React from 'react';
import type { ExecutionSummary, ExecutionState, ModelInputs, OutputConfig } from '../types';

/**
 * Props for ResultsSummary
 */
interface ResultsSummaryProps {
  /** Model ID */
  modelId: string;
  /** Model name */
  modelName: string;
  /** Engine type used */
  engineType: string;
  /** User who ran the model */
  userId: string | null;
  /** Execution summary data */
  summary: ExecutionSummary;
  /** Number of output files */
  outputCount: number;
  /** Model inputs (ignition, weather) */
  inputs?: ModelInputs;
  /** Output configuration used */
  outputConfig?: OutputConfig;
  /** User notes for this model */
  notes?: string;
  /** Callback to add ignition to map */
  onAddIgnitionToMap?: () => void;
}

/**
 * Get status display info
 */
function getStatusInfo(status: ExecutionState): { label: string; color: string; bgColor: string } {
  switch (status) {
    case 'completed':
      return { label: 'Completed', color: '#2e7d32', bgColor: '#e8f5e9' };
    case 'running':
      return { label: 'Running', color: '#1565c0', bgColor: '#e3f2fd' };
    case 'queued':
      return { label: 'Queued', color: '#f57c00', bgColor: '#fff3e0' };
    case 'initializing':
      return { label: 'Initializing', color: '#7b1fa2', bgColor: '#f3e5f5' };
    case 'failed':
      return { label: 'Failed', color: '#c62828', bgColor: '#ffebee' };
    case 'cancelled':
      return { label: 'Cancelled', color: '#616161', bgColor: '#f5f5f5' };
    default:
      return { label: status, color: '#616161', bgColor: '#f5f5f5' };
  }
}

/**
 * Format duration in seconds to human readable
 */
function formatDuration(seconds: number | null): string {
  if (seconds === null) return '-';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Format timestamp
 */
function formatTime(timestamp: string | null): string {
  if (!timestamp) return '-';
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return timestamp;
  }
}

/**
 * ResultsSummary displays execution status and timing information.
 */
export function ResultsSummary({
  modelId,
  modelName,
  engineType,
  userId,
  summary,
  outputCount,
  inputs,
  outputConfig,
  notes,
  onAddIgnitionToMap,
}: ResultsSummaryProps) {
  const ignition = inputs?.ignition;
  const statusInfo = getStatusInfo(summary.status);
  const isInProgress = ['queued', 'initializing', 'running'].includes(summary.status);
  const simLabel = summary.simulationCount
    ? `Probabilistic (${summary.simulationCount} iterations)`
    : 'Probabilistic';

  const containerStyle: React.CSSProperties = {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #e0e0e0',
    padding: '20px',
    marginBottom: '16px',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: '16px',
  };

  const titleSectionStyle: React.CSSProperties = {
    flex: 1,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '20px',
    fontWeight: 600,
    color: '#333',
    margin: 0,
  };

  const engineTagStyle: React.CSSProperties = {
    display: 'inline-block',
    fontSize: '12px',
    padding: '2px 8px',
    borderRadius: '4px',
    backgroundColor: '#f5f5f5',
    color: '#666',
    marginTop: '4px',
  };

  const infoTableHeaderStyle: React.CSSProperties = {
    padding: '4px 12px 4px 0',
    fontWeight: 500,
    color: '#999',
    fontSize: '11px',
    textTransform: 'uppercase',
    textAlign: 'left',
  };

  const infoTableCellStyle: React.CSSProperties = {
    padding: '4px 12px 4px 0',
    verticalAlign: 'middle',
  };

  const statusBadgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '14px',
    fontWeight: 500,
    padding: '6px 12px',
    borderRadius: '20px',
    backgroundColor: statusInfo.bgColor,
    color: statusInfo.color,
  };

  const progressContainerStyle: React.CSSProperties = {
    marginBottom: '16px',
  };

  const progressBarBgStyle: React.CSSProperties = {
    height: '8px',
    backgroundColor: '#e0e0e0',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '4px',
  };

  const progressBarFillStyle: React.CSSProperties = {
    height: '100%',
    backgroundColor: summary.status === 'failed' ? '#c62828' : '#1976d2',
    borderRadius: '4px',
    width: `${summary.progress}%`,
    transition: 'width 0.3s',
  };

  const progressTextStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#666',
    textAlign: 'right',
  };

  const statsGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '16px',
  };

  const statItemStyle: React.CSSProperties = {
    padding: '12px',
    backgroundColor: '#fafafa',
    borderRadius: '6px',
  };

  const statLabelStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#666',
    marginBottom: '4px',
  };

  const statValueStyle: React.CSSProperties = {
    fontSize: '16px',
    fontWeight: 500,
    color: '#333',
  };

  const errorStyle: React.CSSProperties = {
    marginTop: '16px',
    padding: '12px',
    backgroundColor: '#ffebee',
    borderRadius: '6px',
    border: '1px solid #ffcdd2',
    color: '#c62828',
    fontSize: '14px',
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={titleSectionStyle}>
          <h2 style={titleStyle}>{modelName}</h2>
          <table style={{ marginTop: '8px', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr>
                <th style={infoTableHeaderStyle}>Modeller</th>
                <th style={infoTableHeaderStyle}>Mode</th>
                <th style={infoTableHeaderStyle}>User</th>
                <th style={infoTableHeaderStyle}>Model Run ID</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={infoTableCellStyle}>
                  <span style={engineTagStyle}>{engineType.toUpperCase()}</span>
                </td>
                <td style={infoTableCellStyle}>
                  <span style={{ ...engineTagStyle, backgroundColor: '#e8f5e9', color: '#2e7d32' }}>{simLabel}</span>
                </td>
                <td style={infoTableCellStyle}>
                  <span style={{ ...engineTagStyle, backgroundColor: '#e3f2fd', color: '#1565c0' }}>{userId ?? '-'}</span>
                </td>
                <td style={infoTableCellStyle}>
                  <span style={{ ...engineTagStyle, fontFamily: 'monospace', fontSize: '11px' }}>{modelId}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={statusBadgeStyle}>
          {isInProgress && (
            <span style={{ animation: 'pulse 1.5s infinite' }}>&#9679;</span>
          )}
          {statusInfo.label}
        </div>
      </div>

      {/* Notes */}
      {notes && (
        <p style={{
          fontSize: '14px',
          color: '#555',
          margin: '0 0 16px 0',
          fontStyle: 'italic',
          lineHeight: 1.4,
        }}>
          {notes}
        </p>
      )}

      {/* Progress bar (shown during execution) */}
      {isInProgress && (
        <div style={progressContainerStyle}>
          <div style={progressBarBgStyle}>
            <div style={progressBarFillStyle} />
          </div>
          <div style={progressTextStyle}>{summary.progress}% complete</div>
        </div>
      )}

      {/* Stats grid */}
      <div style={statsGridStyle}>
        <div style={statItemStyle}>
          <div style={statLabelStyle}>Started</div>
          <div style={statValueStyle}>{formatTime(summary.startedAt)}</div>
        </div>
        <div style={statItemStyle}>
          <div style={statLabelStyle}>Completed</div>
          <div style={statValueStyle}>{formatTime(summary.completedAt)}</div>
        </div>
        <div style={statItemStyle}>
          <div style={statLabelStyle}>Duration</div>
          <div style={statValueStyle}>{formatDuration(summary.durationSeconds)}</div>
        </div>
        <div style={statItemStyle}>
          <div style={statLabelStyle}>Outputs</div>
          <div style={statValueStyle}>{outputCount} files</div>
        </div>
        {summary.simulationCount !== undefined && (
          <div style={statItemStyle}>
            <div style={statLabelStyle}>Simulations</div>
            <div style={statValueStyle}>{summary.simulationCount.toLocaleString()}</div>
          </div>
        )}
      </div>

      {/* Output Configuration */}
      {outputConfig && (
        <div style={{
          marginTop: '16px',
          border: '1px solid #e0e0e0',
          borderRadius: '6px',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 12px',
            backgroundColor: '#fafafa',
            borderBottom: '1px solid #e0e0e0',
            fontWeight: 500,
            fontSize: '14px',
            color: '#333',
          }}>
            Output Configuration
          </div>
          <div style={{ padding: '12px' }}>
            <div style={statsGridStyle}>
              <div style={statItemStyle}>
                <div style={statLabelStyle}>Output Mode</div>
                <div style={statValueStyle}>
                  {outputConfig.outputMode === 'pseudo-deterministic' ? 'Fire Perimeters' : 'Probability Maps'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Model Inputs section */}
      {inputs && (inputs.ignition || inputs.weatherDownloadUrl) && (
        <div style={{
          marginTop: '16px',
          border: '1px solid #e0e0e0',
          borderRadius: '6px',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 12px',
            backgroundColor: '#fafafa',
            borderBottom: '1px solid #e0e0e0',
            fontWeight: 500,
            fontSize: '14px',
            color: '#333',
          }}>
            Model Inputs
          </div>

          {/* Weather input */}
          {inputs.weatherDownloadUrl && (
            <div style={{
              padding: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: ignition ? '1px solid #e0e0e0' : 'none',
            }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: '#1565c0' }}>
                  Weather Data
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
                  Hourly weather CSV with FWI indices
                </div>
              </div>
              <a
                href={inputs.weatherDownloadUrl}
                download
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  backgroundColor: '#d32f2f',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  textDecoration: 'none',
                }}
              >
                Download Weather
              </a>
            </div>
          )}

          {/* Ignition geometry */}
          {ignition && (
            <div style={{
              padding: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: '#e65100' }}>
                  Ignition {ignition.type === 'point' ? 'Point' : 'Polygon'}
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
                  {ignition.type === 'point'
                    ? `${(ignition.coordinates as [number, number])[1].toFixed(4)}°N, ${(ignition.coordinates as [number, number])[0].toFixed(4)}°W`
                    : 'Fire perimeter polygon'
                  }
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <a
                  href={`/api/v1/models/${modelId}/inputs/ignition`}
                  download
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    backgroundColor: '#e65100',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    textDecoration: 'none',
                  }}
                >
                  Download Ignition
                </a>
                {onAddIgnitionToMap && (
                  <button
                    onClick={onAddIgnitionToMap}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 500,
                      backgroundColor: '#7b1fa2',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    <i className="fa-solid fa-bezier-curve" style={{ marginRight: '4px' }} />
                    Add Igntion to Map
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {summary.error && (
        <div style={errorStyle}>
          <strong>Error:</strong> {summary.error}
        </div>
      )}
    </div>
  );
}
