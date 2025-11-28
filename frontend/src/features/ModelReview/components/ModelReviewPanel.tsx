/**
 * Model Review Panel
 *
 * Main container for viewing model results.
 * Combines ResultsSummary, OutputList, and handles preview modal.
 */

import React, { useState, useCallback } from 'react';
import { ResultsSummary } from './ResultsSummary';
import { OutputList } from './OutputList';
import { OutputPreviewModal } from './OutputPreviewModal';
import { useModelResults } from '../hooks/useModelResults';
import type { OutputItem } from '../types';

/**
 * API configuration
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

/**
 * Props for ModelReviewPanel
 */
interface ModelReviewPanelProps {
  /** Model ID to review */
  modelId: string;
  /** Called when panel is closed */
  onClose: () => void;
  /** Called when output is added to main map */
  onAddToMap?: (output: OutputItem, geoJson: GeoJSON.GeoJSON) => void;
}

/**
 * ModelReviewPanel displays full model results with preview capabilities.
 */
export function ModelReviewPanel({
  modelId,
  onClose,
  onAddToMap,
}: ModelReviewPanelProps) {
  const { results, isLoading, error, refetch } = useModelResults(modelId);
  const [previewOutput, setPreviewOutput] = useState<OutputItem | null>(null);

  /**
   * Handle preview request
   */
  const handlePreview = useCallback((output: OutputItem) => {
    setPreviewOutput(output);
  }, []);

  /**
   * Handle download request
   */
  const handleDownload = useCallback((output: OutputItem) => {
    // Open download URL in new tab
    window.open(`${API_BASE_URL}${output.downloadUrl}`, '_blank');
  }, []);

  /**
   * Handle add to map request from output list or preview modal
   */
  const handleAddToMap = useCallback(
    async (output: OutputItem) => {
      if (!onAddToMap) return;

      try {
        // Fetch the GeoJSON preview
        const response = await fetch(`${API_BASE_URL}${output.previewUrl}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch GeoJSON: ${response.status}`);
        }
        const geoJson = await response.json();
        onAddToMap(output, geoJson);
      } catch (err) {
        console.error('Failed to add to map:', err);
        alert('Failed to load output data for map');
      }
    },
    [onAddToMap]
  );

  /**
   * Close preview modal
   */
  const handleClosePreview = useCallback(() => {
    setPreviewOutput(null);
  }, []);

  // Loading state
  if (isLoading && !results) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>Model Results</h2>
          <button style={closeButtonStyle} onClick={onClose}>
            &times;
          </button>
        </div>
        <div style={loadingStyle}>
          <div style={spinnerStyle} />
          <div>Loading results...</div>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !results) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>Model Results</h2>
          <button style={closeButtonStyle} onClick={onClose}>
            &times;
          </button>
        </div>
        <div style={errorStyle}>
          <div style={errorIconStyle}>!</div>
          <div style={errorTextStyle}>Failed to load results</div>
          <div style={errorDetailStyle}>{error}</div>
          <button style={retryButtonStyle} onClick={refetch}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // No results
  if (!results) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>Model Results</h2>
          <button style={closeButtonStyle} onClick={onClose}>
            &times;
          </button>
        </div>
        <div style={emptyStyle}>No results found for this model.</div>
      </div>
    );
  }

  return (
    <>
      <div style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={titleStyle}>Model Results</h2>
          <button style={closeButtonStyle} onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Content */}
        <div style={contentStyle}>
          {/* Summary */}
          <ResultsSummary
            modelName={results.modelName}
            engineType={results.engineType}
            summary={results.executionSummary}
            outputCount={results.outputs.length}
          />

          {/* Output list */}
          <OutputList
            outputs={results.outputs}
            onPreview={handlePreview}
            onDownload={handleDownload}
            onAddToMap={handleAddToMap}
          />
        </div>
      </div>

      {/* Preview modal */}
      {previewOutput && (
        <OutputPreviewModal
          output={previewOutput}
          onClose={handleClosePreview}
          onAddToMap={handleAddToMap}
        />
      )}
    </>
  );
}

// Styles
const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: '16px',
  right: '16px',
  width: '400px',
  maxHeight: 'calc(100vh - 32px)',
  backgroundColor: 'white',
  borderRadius: '12px',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 1000,
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid #e0e0e0',
};

const titleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 600,
  color: '#333',
  margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: '24px',
  fontWeight: 300,
  color: '#666',
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  borderRadius: '4px',
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const loadingStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '12px',
  padding: '40px',
  color: '#666',
};

const spinnerStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  border: '3px solid #e0e0e0',
  borderTopColor: '#1976d2',
  borderRadius: '50%',
  animation: 'spin 1s linear infinite',
};

const errorStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '40px',
};

const errorIconStyle: React.CSSProperties = {
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  backgroundColor: '#ffebee',
  color: '#c62828',
  fontSize: '24px',
  fontWeight: 'bold',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: '8px',
};

const errorTextStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 500,
  color: '#c62828',
};

const errorDetailStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#666',
  textAlign: 'center',
};

const retryButtonStyle: React.CSSProperties = {
  marginTop: '12px',
  padding: '8px 16px',
  fontSize: '14px',
  color: '#1976d2',
  backgroundColor: '#e3f2fd',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
};

const emptyStyle: React.CSSProperties = {
  padding: '40px 20px',
  textAlign: 'center',
  color: '#666',
};
