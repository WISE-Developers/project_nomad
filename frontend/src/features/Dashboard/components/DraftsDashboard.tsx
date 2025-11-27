/**
 * Drafts Dashboard Component
 *
 * Displays all draft models with the ability to resume or delete.
 */

import React, { useState, useCallback } from 'react';
import { useDrafts } from '../hooks/useDrafts';
import { DraftCard } from './DraftCard';
import type { DraftType, DraftSortOption } from '../types/draft';

/**
 * Props for DraftsDashboard
 */
interface DraftsDashboardProps {
  /** Called when user clicks resume on a draft */
  onResume: (draftId: string) => void;
  /** Called when user wants to create a new model */
  onCreateNew?: () => void;
  /** CSS class */
  className?: string;
}

/**
 * DraftsDashboard shows all saved draft models.
 *
 * @example
 * ```tsx
 * <DraftsDashboard
 *   onResume={(id) => navigate(`/wizard/${id}`)}
 *   onCreateNew={() => navigate('/wizard/new')}
 * />
 * ```
 */
export function DraftsDashboard({
  onResume,
  onCreateNew,
  className = '',
}: DraftsDashboardProps) {
  const {
    drafts,
    isLoading,
    isEmpty,
    sortBy,
    sortDirection,
    filters,
    setFilters,
    toggleSort,
    deleteDraft,
    deleteDrafts,
    refresh,
  } = useDrafts({ refreshInterval: 30000 });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleSelect = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === drafts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(drafts.map((d) => d.id)));
    }
  }, [drafts, selectedIds.size]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`Delete ${selectedIds.size} draft(s)? This cannot be undone.`)) {
      deleteDrafts(Array.from(selectedIds));
      setSelectedIds(new Set());
    }
  }, [selectedIds, deleteDrafts]);

  const handleTypeFilter = useCallback((type: DraftType | '') => {
    setFilters((prev) => ({
      ...prev,
      type: type === '' ? undefined : type,
    }));
  }, [setFilters]);

  const handleSearch = useCallback((search: string) => {
    setFilters((prev) => ({
      ...prev,
      search: search || undefined,
    }));
  }, [setFilters]);

  const containerStyle: React.CSSProperties = {
    padding: '24px',
    maxWidth: '1200px',
    margin: '0 auto',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '24px',
    flexWrap: 'wrap',
    gap: '16px',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '28px',
    fontWeight: 600,
    color: '#333',
    margin: 0,
  };

  const actionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  };

  const toolbarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#f5f5f5',
    borderRadius: '8px',
    flexWrap: 'wrap',
    gap: '12px',
  };

  const filterGroupStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  };

  const selectStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    fontSize: '14px',
    backgroundColor: 'white',
  };

  const inputStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    fontSize: '14px',
    width: '200px',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '10px 20px',
    borderRadius: '4px',
    border: 'none',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#1976d2',
    color: 'white',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: 'white',
    color: '#333',
    border: '1px solid #ccc',
  };

  const dangerButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: 'white',
    color: '#d32f2f',
    border: '1px solid #ffcdd2',
  };

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '16px',
  };

  const emptyStateStyle: React.CSSProperties = {
    textAlign: 'center',
    padding: '48px 24px',
    backgroundColor: '#fafafa',
    borderRadius: '8px',
    border: '2px dashed #e0e0e0',
  };

  const emptyIconStyle: React.CSSProperties = {
    fontSize: '48px',
    marginBottom: '16px',
  };

  const emptyTitleStyle: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 600,
    color: '#333',
    marginBottom: '8px',
  };

  const emptyTextStyle: React.CSSProperties = {
    fontSize: '14px',
    color: '#666',
    marginBottom: '24px',
  };

  const sortOptions: { value: DraftSortOption; label: string }[] = [
    { value: 'updatedAt', label: 'Last Modified' },
    { value: 'createdAt', label: 'Created' },
    { value: 'name', label: 'Name' },
    { value: 'completion', label: 'Completion' },
  ];

  const typeOptions: { value: DraftType | ''; label: string }[] = [
    { value: '', label: 'All Types' },
    { value: 'model-setup', label: 'Fire Models' },
    { value: 'model-review', label: 'Reviews' },
    { value: 'model-export', label: 'Exports' },
  ];

  if (isLoading) {
    return (
      <div style={containerStyle} className={className}>
        <div style={{ textAlign: 'center', padding: '48px' }}>
          <p>Loading drafts...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle} className={`drafts-dashboard ${className}`}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Your Drafts</h1>
        <div style={actionsStyle}>
          <button
            style={secondaryButtonStyle}
            onClick={refresh}
            title="Refresh"
          >
            🔄 Refresh
          </button>
          {onCreateNew && (
            <button style={primaryButtonStyle} onClick={onCreateNew}>
              + New Model
            </button>
          )}
        </div>
      </div>

      {!isEmpty && (
        <div style={toolbarStyle}>
          <div style={filterGroupStyle}>
            <input
              type="checkbox"
              checked={selectedIds.size > 0 && selectedIds.size === drafts.length}
              onChange={handleSelectAll}
              aria-label="Select all"
            />
            <span style={{ fontSize: '14px', color: '#666' }}>
              {selectedIds.size > 0
                ? `${selectedIds.size} selected`
                : `${drafts.length} draft${drafts.length !== 1 ? 's' : ''}`}
            </span>
            {selectedIds.size > 0 && (
              <button style={dangerButtonStyle} onClick={handleDeleteSelected}>
                Delete Selected
              </button>
            )}
          </div>

          <div style={filterGroupStyle}>
            <input
              type="text"
              placeholder="Search drafts..."
              value={filters.search || ''}
              onChange={(e) => handleSearch(e.target.value)}
              style={inputStyle}
            />
            <select
              value={filters.type || ''}
              onChange={(e) => handleTypeFilter(e.target.value as DraftType | '')}
              style={selectStyle}
            >
              {typeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => toggleSort(e.target.value as DraftSortOption)}
              style={selectStyle}
            >
              {sortOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} {sortBy === opt.value ? (sortDirection === 'desc' ? '↓' : '↑') : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {isEmpty ? (
        <div style={emptyStateStyle}>
          <div style={emptyIconStyle}>📝</div>
          <h2 style={emptyTitleStyle}>No Drafts Yet</h2>
          <p style={emptyTextStyle}>
            Your in-progress fire models will appear here.
            <br />
            Start a new model to get started.
          </p>
          {onCreateNew && (
            <button style={primaryButtonStyle} onClick={onCreateNew}>
              + Create New Model
            </button>
          )}
        </div>
      ) : (
        <div style={gridStyle}>
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              onResume={onResume}
              onDelete={deleteDraft}
              isSelected={selectedIds.has(draft.id)}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
