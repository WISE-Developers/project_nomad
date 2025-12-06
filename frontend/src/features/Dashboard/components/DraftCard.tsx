/**
 * Draft Card Component
 *
 * Displays a single draft model with actions.
 */

import React from 'react';
import type { DraftSummary, DraftType } from '../types/draft';

/**
 * Props for DraftCard
 */
interface DraftCardProps {
  /** Draft to display */
  draft: DraftSummary;
  /** Called when resume button is clicked */
  onResume: (draftId: string) => void;
  /** Called when delete button is clicked */
  onDelete: (draftId: string) => void;
  /** Whether the card is selected */
  isSelected?: boolean;
  /** Called when selection changes */
  onSelect?: (draftId: string, selected: boolean) => void;
}

/**
 * Get display name for draft type
 */
function getTypeName(type: DraftType): string {
  switch (type) {
    case 'model-setup':
      return 'Fire Model';
    case 'model-review':
      return 'Model Review';
    case 'model-export':
      return 'Export';
    default:
      return 'Draft';
  }
}

/**
 * Get icon class for draft type
 */
function getTypeIconClass(type: DraftType): string {
  switch (type) {
    case 'model-setup':
      return 'fa-fire';
    case 'model-review':
      return 'fa-chart-bar';
    case 'model-export':
      return 'fa-file-export';
    default:
      return 'fa-file-pen';
  }
}

/**
 * Format relative time
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * DraftCard displays a draft model summary with actions.
 */
export function DraftCard({
  draft,
  onResume,
  onDelete,
  isSelected = false,
  onSelect,
}: DraftCardProps) {
  const handleResume = () => onResume(draft.id);
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${draft.name}"? This cannot be undone.`)) {
      onDelete(draft.id);
    }
  };
  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSelect?.(draft.id, e.target.checked);
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: isSelected ? '2px solid #1976d2' : '1px solid #e0e0e0',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: isSelected ? '0 2px 8px rgba(25, 118, 210, 0.2)' : '0 1px 3px rgba(0,0,0,0.1)',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
  };

  const titleSectionStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
  };

  const iconStyle: React.CSSProperties = {
    fontSize: '24px',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '16px',
    fontWeight: 600,
    color: '#333',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };

  const typeTagStyle: React.CSSProperties = {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '12px',
    backgroundColor: '#e3f2fd',
    color: '#1565c0',
    fontWeight: 500,
  };

  const progressContainerStyle: React.CSSProperties = {
    width: '100%',
  };

  const progressBarBgStyle: React.CSSProperties = {
    height: '6px',
    backgroundColor: '#e0e0e0',
    borderRadius: '3px',
    overflow: 'hidden',
  };

  const progressBarFillStyle: React.CSSProperties = {
    height: '100%',
    backgroundColor: draft.completionPercentage === 100 ? '#4caf50' : '#1976d2',
    borderRadius: '3px',
    width: `${draft.completionPercentage}%`,
    transition: 'width 0.3s',
  };

  const progressTextStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#666',
    marginTop: '4px',
    display: 'flex',
    justifyContent: 'space-between',
  };

  const metaStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#666',
    display: 'flex',
    gap: '16px',
  };

  const actionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
    marginTop: '4px',
  };

  const resumeButtonStyle: React.CSSProperties = {
    flex: 1,
    padding: '8px 16px',
    backgroundColor: '#1976d2',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  };

  const deleteButtonStyle: React.CSSProperties = {
    padding: '8px 12px',
    backgroundColor: 'white',
    color: '#d32f2f',
    border: '1px solid #ffcdd2',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
  };

  return (
    <div
      style={cardStyle}
      onClick={handleResume}
      role="article"
      aria-label={`Draft: ${draft.name}`}
    >
      <div style={headerStyle}>
        {onSelect && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleSelect}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${draft.name}`}
          />
        )}
        <div style={titleSectionStyle}>
          <i className={`fa-solid ${getTypeIconClass(draft.type)}`} style={iconStyle} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={titleStyle}>{draft.name}</h3>
            {draft.description && (
              <p style={{ ...metaStyle, marginTop: '4px', marginBottom: 0 }}>
                {draft.description}
              </p>
            )}
          </div>
        </div>
        <span style={typeTagStyle}>{getTypeName(draft.type)}</span>
      </div>

      <div style={progressContainerStyle}>
        <div style={progressBarBgStyle}>
          <div style={progressBarFillStyle} />
        </div>
        <div style={progressTextStyle}>
          <span>Step {draft.currentStep + 1} of {draft.totalSteps}</span>
          <span>{draft.completionPercentage}% complete</span>
        </div>
      </div>

      <div style={metaStyle}>
        <span>Modified {formatRelativeTime(draft.updatedAt)}</span>
        <span>Created {formatRelativeTime(draft.createdAt)}</span>
      </div>

      <div style={actionsStyle}>
        <button
          style={resumeButtonStyle}
          onClick={handleResume}
        >
          Continue
        </button>
        <button
          style={deleteButtonStyle}
          onClick={handleDelete}
          aria-label={`Delete ${draft.name}`}
        >
          <i className="fa-solid fa-trash" />
        </button>
      </div>
    </div>
  );
}
