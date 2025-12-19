/**
 * Model Card Component
 *
 * Displays a single model in a card format for the Dashboard.
 *
 * @module features/Dashboard/components
 */

import React, { useCallback } from 'react';
import type { Model, ModelStatus, EngineType } from '../../../openNomad/api.js';

// =============================================================================
// Types
// =============================================================================

export interface ModelCardProps {
  /** Model to display */
  model: Model;
  /** Whether the card is selected */
  isSelected?: boolean;
  /** Called when selection changes */
  onSelect?: (id: string, selected: boolean) => void;
  /** Called when view results is clicked */
  onViewResults?: (model: Model) => void;
  /** Called when add to map is clicked */
  onAddToMap?: (model: Model) => void;
  /** Called when delete is clicked */
  onDelete?: (model: Model) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

function getStatusColor(status: ModelStatus): string {
  switch (status) {
    case 'completed':
      return '#4caf50';
    case 'running':
      return '#2196f3';
    case 'queued':
      return '#ff9800';
    case 'failed':
      return '#f44336';
    case 'draft':
      return '#9e9e9e';
    default:
      return '#9e9e9e';
  }
}

function getStatusLabel(status: ModelStatus): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'running':
      return 'Running';
    case 'queued':
      return 'Queued';
    case 'failed':
      return 'Failed';
    case 'draft':
      return 'Draft';
    default:
      return status;
  }
}

function getEngineLabel(engine: EngineType): string {
  switch (engine) {
    case 'firestarr':
      return 'FireSTARR';
    case 'wise':
      return 'WISE';
    default:
      return engine;
  }
}

// =============================================================================
// Component
// =============================================================================

/**
 * ModelCard displays a single model with status, actions, and metadata.
 *
 * @example
 * ```tsx
 * <ModelCard
 *   model={model}
 *   onViewResults={(m) => showResults(m.id)}
 *   onDelete={(m) => confirmDelete(m.id)}
 * />
 * ```
 */
export function ModelCard({
  model,
  isSelected = false,
  onSelect,
  onViewResults,
  onAddToMap,
  onDelete,
}: ModelCardProps) {
  const handleCheckboxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    onSelect?.(model.id, e.target.checked);
  }, [model.id, onSelect]);

  const handleViewResults = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onViewResults?.(model);
  }, [model, onViewResults]);

  const handleAddToMap = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToMap?.(model);
  }, [model, onAddToMap]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${model.name}"? This cannot be undone.`)) {
      onDelete?.(model);
    }
  }, [model, onDelete]);

  const statusColor = getStatusColor(model.status);
  const isCompleted = model.status === 'completed';
  const isRunning = model.status === 'running';
  const isFailed = model.status === 'failed';

  return (
    <div
      style={{
        ...cardStyle,
        ...(isSelected ? selectedCardStyle : {}),
      }}
    >
      {/* Header row */}
      <div style={headerRowStyle}>
        {onSelect && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleCheckboxChange}
            style={checkboxStyle}
            aria-label={`Select ${model.name}`}
          />
        )}
        <div style={titleContainerStyle}>
          <h3 style={titleStyle}>{model.name}</h3>
          <span style={modelIdStyle}>{model.id}</span>
        </div>
      </div>

      {/* Status and engine */}
      <div style={metaRowStyle}>
        <span
          style={{
            ...statusBadgeStyle,
            backgroundColor: `${statusColor}20`,
            color: statusColor,
            borderColor: statusColor,
          }}
        >
          {isRunning && <span style={pulseStyle} />}
          {getStatusLabel(model.status)}
        </span>
        <span style={engineBadgeStyle}>{getEngineLabel(model.engine)}</span>
      </div>

      {/* Timestamps */}
      <div style={timestampRowStyle}>
        <span style={timestampStyle}>
          Created: {formatRelativeTime(model.createdAt)}
        </span>
        {model.updatedAt !== model.createdAt && (
          <span style={timestampStyle}>
            Updated: {formatRelativeTime(model.updatedAt)}
          </span>
        )}
      </div>

      {/* Notes */}
      {model.notes && (
        <p style={notesStyle}>{model.notes}</p>
      )}

      {/* Actions */}
      <div style={actionsRowStyle}>
        {isCompleted && (
          <>
            {onViewResults && (
              <button
                onClick={handleViewResults}
                style={primaryButtonStyle}
                aria-label="View results"
              >
                View Results
              </button>
            )}
            {onAddToMap && (
              <button
                onClick={handleAddToMap}
                style={secondaryButtonStyle}
                aria-label="Add to map"
              >
                Add to Map
              </button>
            )}
          </>
        )}
        {isFailed && (
          <span style={errorTextStyle}>Model execution failed</span>
        )}
        {onDelete && (
          <button
            onClick={handleDelete}
            style={deleteButtonStyle}
            aria-label="Delete model"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Styles
// =============================================================================

const cardStyle: React.CSSProperties = {
  padding: '16px',
  backgroundColor: 'white',
  border: '1px solid #e0e0e0',
  borderRadius: '8px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
};

const selectedCardStyle: React.CSSProperties = {
  borderColor: '#1976d2',
  boxShadow: '0 0 0 2px rgba(25, 118, 210, 0.2)',
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '12px',
};

const checkboxStyle: React.CSSProperties = {
  marginTop: '4px',
  cursor: 'pointer',
};

const titleContainerStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#333',
  margin: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const modelIdStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#999',
  fontFamily: 'monospace',
};

const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
};

const statusBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 10px',
  fontSize: '12px',
  fontWeight: 500,
  borderRadius: '12px',
  border: '1px solid',
};

const pulseStyle: React.CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  backgroundColor: 'currentColor',
  animation: 'pulse 1.5s infinite',
};

const engineBadgeStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '12px',
  fontWeight: 500,
  backgroundColor: '#f5f5f5',
  color: '#666',
  borderRadius: '12px',
};

const timestampRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
};

const timestampStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#888',
};

const notesStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#666',
  margin: 0,
  lineHeight: 1.4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
};

const actionsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginTop: '4px',
  flexWrap: 'wrap',
};

const buttonBaseStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 500,
  borderRadius: '4px',
  cursor: 'pointer',
  border: 'none',
  transition: 'all 0.2s ease',
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: '#1976d2',
  color: 'white',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: 'white',
  color: '#333',
  border: '1px solid #ccc',
};

const deleteButtonStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: 'transparent',
  color: '#d32f2f',
  marginLeft: 'auto',
};

const errorTextStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#d32f2f',
  fontStyle: 'italic',
};
