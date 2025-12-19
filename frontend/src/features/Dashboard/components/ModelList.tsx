/**
 * Model List Component
 *
 * Displays a list of models with filtering, sorting, and actions.
 *
 * @module features/Dashboard/components
 */

import React, { useCallback, useState } from 'react';
import { useModels } from '../hooks/useModels.js';
import { useModelSelection } from '../context/DashboardContext.js';
import { ModelCard } from './ModelCard.js';
import type { Model, ModelStatus, EngineType } from '../../../openNomad/api.js';
import type { ModelSortOption } from '../context/DashboardContext.js';

// =============================================================================
// Types
// =============================================================================

export interface ModelListProps {
  /** Called when view results is clicked */
  onViewResults?: (model: Model) => void;
  /** Called when add to map is clicked */
  onAddToMap?: (model: Model) => void;
  /** Called when user wants to create a new model */
  onCreateNew?: () => void;
  /** CSS class */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ModelList displays all models with filtering and sorting controls.
 *
 * @example
 * ```tsx
 * <ModelList
 *   onViewResults={(model) => showResults(model.id)}
 *   onCreateNew={() => launchWizard()}
 * />
 * ```
 */
export function ModelList({
  onViewResults,
  onAddToMap,
  onCreateNew,
  className = '',
}: ModelListProps) {
  const {
    models,
    isLoading,
    error,
    filters,
    sort,
    setFilters,
    setSort,
    deleteModel,
    refresh,
  } = useModels({ autoFetch: true, refreshInterval: 30000 });

  const {
    selectedModelIds,
    toggleModelSelection,
    selectAllModels,
    clearModelSelection,
    hasSelection,
    selectedCount,
  } = useModelSelection();

  const [showFilters, setShowFilters] = useState(false);

  // Handle filter changes
  const handleStatusFilter = useCallback((status: ModelStatus | '') => {
    setFilters({
      ...filters,
      status: status === '' ? undefined : status,
    });
  }, [filters, setFilters]);

  const handleEngineFilter = useCallback((engine: EngineType | '') => {
    setFilters({
      ...filters,
      engine: engine === '' ? undefined : engine,
    });
  }, [filters, setFilters]);

  const handleSearch = useCallback((search: string) => {
    setFilters({
      ...filters,
      search: search || undefined,
    });
  }, [filters, setFilters]);

  // Handle sort changes
  const handleSort = useCallback((sortBy: ModelSortOption) => {
    setSort(sortBy);
  }, [setSort]);

  // Handle delete
  const handleDelete = useCallback(async (model: Model) => {
    await deleteModel(model.id);
  }, [deleteModel]);

  // Handle bulk delete
  const handleDeleteSelected = useCallback(async () => {
    if (selectedCount === 0) return;
    if (!window.confirm(`Delete ${selectedCount} model(s)? This cannot be undone.`)) return;

    for (const id of selectedModelIds) {
      await deleteModel(id);
    }
    clearModelSelection();
  }, [selectedModelIds, selectedCount, deleteModel, clearModelSelection]);

  // Handle select all toggle
  const handleSelectAll = useCallback(() => {
    if (selectedCount === models.length && models.length > 0) {
      clearModelSelection();
    } else {
      selectAllModels();
    }
  }, [selectedCount, models.length, clearModelSelection, selectAllModels]);

  // Sort options
  const sortOptions: { value: ModelSortOption; label: string }[] = [
    { value: 'createdAt', label: 'Created' },
    { value: 'updatedAt', label: 'Updated' },
    { value: 'name', label: 'Name' },
    { value: 'status', label: 'Status' },
  ];

  // Status filter options
  const statusOptions: { value: ModelStatus | ''; label: string }[] = [
    { value: '', label: 'All Statuses' },
    { value: 'completed', label: 'Completed' },
    { value: 'running', label: 'Running' },
    { value: 'queued', label: 'Queued' },
    { value: 'failed', label: 'Failed' },
    { value: 'draft', label: 'Draft' },
  ];

  // Engine filter options
  const engineOptions: { value: EngineType | ''; label: string }[] = [
    { value: '', label: 'All Engines' },
    { value: 'firestarr', label: 'FireSTARR' },
    { value: 'wise', label: 'WISE' },
  ];

  // Loading state
  if (isLoading && models.length === 0) {
    return (
      <div style={containerStyle} className={className}>
        <div style={loadingStyle}>
          <p>Loading models...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={containerStyle} className={className}>
        <div style={errorStyle}>
          <p>Error: {error}</p>
          <button onClick={refresh} style={retryButtonStyle}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle} className={`model-list ${className}`}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={headerLeftStyle}>
          <span style={countStyle}>
            {models.length} model{models.length !== 1 ? 's' : ''}
          </span>
          <button
            onClick={() => setShowFilters(!showFilters)}
            style={filterToggleStyle}
          >
            {showFilters ? 'Hide Filters' : 'Filters'}
          </button>
        </div>
        <div style={headerRightStyle}>
          <button onClick={refresh} style={iconButtonStyle} title="Refresh">
            Refresh
          </button>
          {onCreateNew && (
            <button onClick={onCreateNew} style={createButtonStyle}>
              + New Model
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div style={filtersStyle}>
          <input
            type="text"
            placeholder="Search models..."
            value={filters.search || ''}
            onChange={(e) => handleSearch(e.target.value)}
            style={searchInputStyle}
          />
          <select
            value={filters.status || ''}
            onChange={(e) => handleStatusFilter(e.target.value as ModelStatus | '')}
            style={selectStyle}
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={filters.engine || ''}
            onChange={(e) => handleEngineFilter(e.target.value as EngineType | '')}
            style={selectStyle}
          >
            {engineOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={sort.by}
            onChange={(e) => handleSort(e.target.value as ModelSortOption)}
            style={selectStyle}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} {sort.by === opt.value ? (sort.direction === 'desc' ? 'Down' : 'Up') : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Bulk actions */}
      {models.length > 0 && (
        <div style={bulkActionsStyle}>
          <label style={selectAllLabelStyle}>
            <input
              type="checkbox"
              checked={selectedCount > 0 && selectedCount === models.length}
              onChange={handleSelectAll}
            />
            <span>
              {hasSelection
                ? `${selectedCount} selected`
                : 'Select all'}
            </span>
          </label>
          {hasSelection && (
            <button onClick={handleDeleteSelected} style={deleteSelectedStyle}>
              Delete Selected
            </button>
          )}
        </div>
      )}

      {/* Empty state */}
      {models.length === 0 && (
        <div style={emptyStyle}>
          <div style={emptyIconStyle}>
            <i className="fa-solid fa-fire" />
          </div>
          <h3 style={emptyTitleStyle}>No Models Yet</h3>
          <p style={emptyTextStyle}>
            Your fire models will appear here after you run them.
          </p>
          {onCreateNew && (
            <button onClick={onCreateNew} style={createButtonStyle}>
              + Create New Model
            </button>
          )}
        </div>
      )}

      {/* Model list */}
      {models.length > 0 && (
        <div style={listStyle}>
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              isSelected={selectedModelIds.includes(model.id)}
              onSelect={toggleModelSelection}
              onViewResults={onViewResults}
              onAddToMap={onAddToMap}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Styles
// =============================================================================

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid #f0f0f0',
  backgroundColor: 'white',
};

const headerLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
};

const headerRightStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const countStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#666',
};

const filterToggleStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '12px',
  color: '#666',
  backgroundColor: '#f5f5f5',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};

const iconButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '12px',
  color: '#666',
  backgroundColor: 'white',
  border: '1px solid #e0e0e0',
  borderRadius: '4px',
  cursor: 'pointer',
};

const createButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '13px',
  fontWeight: 500,
  color: 'white',
  backgroundColor: '#1976d2',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};

const filtersStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '12px 16px',
  backgroundColor: '#fafafa',
  borderBottom: '1px solid #f0f0f0',
  flexWrap: 'wrap',
};

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: '150px',
  padding: '8px 12px',
  fontSize: '13px',
  border: '1px solid #e0e0e0',
  borderRadius: '4px',
};

const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '13px',
  border: '1px solid #e0e0e0',
  borderRadius: '4px',
  backgroundColor: 'white',
};

const bulkActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 16px',
  backgroundColor: '#fafafa',
  borderBottom: '1px solid #f0f0f0',
};

const selectAllLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
  color: '#666',
  cursor: 'pointer',
};

const deleteSelectedStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '12px',
  fontWeight: 500,
  color: '#d32f2f',
  backgroundColor: 'white',
  border: '1px solid #ffcdd2',
  borderRadius: '4px',
  cursor: 'pointer',
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const loadingStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#666',
};

const errorStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '16px',
  color: '#d32f2f',
};

const retryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '13px',
  color: 'white',
  backgroundColor: '#d32f2f',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};

const emptyStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '48px 24px',
  textAlign: 'center',
};

const emptyIconStyle: React.CSSProperties = {
  fontSize: '48px',
  color: '#ddd',
  marginBottom: '16px',
};

const emptyTitleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 600,
  color: '#333',
  margin: '0 0 8px 0',
};

const emptyTextStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#666',
  margin: '0 0 24px 0',
};
