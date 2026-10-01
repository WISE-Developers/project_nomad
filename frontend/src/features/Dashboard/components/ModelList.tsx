/**
 * Model List Component
 *
 * Displays a list of models with filtering, sorting, and actions.
 *
 * @module features/Dashboard/components
 */

import React, { useCallback, useState, useRef } from 'react';
import { useModels } from '../hooks/useModels.js';
import { useModelSelection } from '../context/useDashboard.js';
import { ModelCard } from './ModelCard.js';
import { isProgressStatus } from './importStatus.js';
import { buildRerunRequest } from './rerunRequest.js';
import { useOpenNomad } from '../../../openNomad/index.js';
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

const importButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  backgroundColor: '#2196f3',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
};

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
  onAddToMap: _onAddToMap,
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
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const api = useOpenNomad();

  // Handle model import from ZIP
  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportStatus('Importing...');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const username = localStorage.getItem('nomad_username') || '';
      const headers: Record<string, string> = {};
      if (username) headers['X-Nomad-User'] = username;
      const res = await api.fetch('/api/v1/import', {
        method: 'POST',
        body: formData,
        headers,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || `Import failed: ${res.status}`);
      }
      const result = await res.json();
      const configNote = result.hasConfig ? ' (config preserved — model can be re-run)' : '';
      setImportStatus(`Imported "${result.name}" — ${result.imported.files} files, ${result.imported.results} results${configNote}`);
      refresh();
      setTimeout(() => setImportStatus(null), 8000);
    } catch (err) {
      setImportStatus(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setTimeout(() => setImportStatus(null), 5000);
    }
    // Reset input so same file can be re-imported
    if (importInputRef.current) importInputRef.current.value = '';
  }, [api, refresh]);

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

  // Handle model re-run
  const handleRerun = useCallback(async (model: Model) => {
    setImportStatus(`Fetching config for "${model.name}"...`);
    try {
      const configRes = await api.fetch(`/api/v1/models/${model.id}/config`);
      if (!configRes.ok) throw new Error('Failed to fetch model config');
      const { hasConfig, config } = await configRes.json();
      if (!hasConfig || !config) {
        setImportStatus('No config available — model cannot be re-run');
        setTimeout(() => setImportStatus(null), 5000);
        return;
      }

      const built = buildRerunRequest(model, config);
      if (!built.ok) {
        const message = built.reason === 'missing-timezone'
          ? 'Incomplete config — missing timezone (was the model exported before timezone support?)'
          : 'Incomplete config — missing ignition, time range, or weather data';
        setImportStatus(message);
        setTimeout(() => setImportStatus(null), 6000);
        return;
      }
      const runBody = built.body;

      setImportStatus('Starting model run...');
      const username = localStorage.getItem('nomad_username') || '';
      const runHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (username) runHeaders['X-Nomad-User'] = username;
      const runRes = await api.fetch('/api/v1/models/run', {
        method: 'POST',
        headers: runHeaders,
        body: JSON.stringify(runBody),
      });
      if (!runRes.ok) {
        const err = await runRes.json().catch(() => ({ message: runRes.statusText }));
        throw new Error(err.message || `Run failed: ${runRes.status}`);
      }
      const runResult = await runRes.json();
      setImportStatus(`Model re-run started — new model ID: ${runResult.modelId}`);
      refresh();
      // Poll rapidly for completion — models typically finish in 5-15 seconds
      const pollDelays = [3000, 5000, 10000, 15000, 20000];
      for (const delay of pollDelays) {
        setTimeout(() => refresh(), delay);
      }
      setTimeout(() => setImportStatus(null), 8000);
    } catch (err) {
      setImportStatus(`Re-run failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setTimeout(() => setImportStatus(null), 5000);
    }
  }, [api, refresh]);

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
          <button onClick={handleImportClick} style={importButtonStyle}>
            Import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            onChange={handleImportFile}
            style={{ display: 'none' }}
          />
          {onCreateNew && (
            <button onClick={onCreateNew} style={createButtonStyle}>
              + New Model
            </button>
          )}
        </div>
      </div>

      {/* Import status */}
      {importStatus && (
        <div style={{
          padding: '8px 12px',
          margin: '0 12px 8px',
          borderRadius: '4px',
          fontSize: '13px',
          backgroundColor: importStatus.startsWith('Import failed') ? '#ffebee' : '#e8f5e9',
          color: importStatus.startsWith('Import failed') ? '#c62828' : '#2e7d32',
        }}>
          {isProgressStatus(importStatus) && (
            <i
              className="fa-solid fa-spinner fa-spin"
              style={{ marginRight: '8px' }}
              aria-hidden="true"
            />
          )}
          {importStatus}
        </div>
      )}

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
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            {onCreateNew && (
              <button onClick={onCreateNew} style={createButtonStyle}>
                + Create New Model
              </button>
            )}
            <button onClick={handleImportClick} style={importButtonStyle}>
              Import from ZIP
            </button>
          </div>
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
              onDelete={handleDelete}
              onRerun={handleRerun}
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
