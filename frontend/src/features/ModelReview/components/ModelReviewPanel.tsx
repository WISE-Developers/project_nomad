/**
 * Model Review Panel
 *
 * Main container for viewing model results.
 * Combines ResultsSummary, OutputList, and handles preview modal.
 */

import React, { useState, useCallback } from 'react';
import { Rnd } from 'react-rnd';
import { ResultsSummary } from './ResultsSummary';
import { OutputList, type BreaksMode } from './OutputList';
import { OutputPreviewModal } from './OutputPreviewModal';
import { useModelResults } from '../hooks/useModelResults';
import { ExportPanel } from '../../Export';
import { useOpenNomad } from '../../../openNomad/context';
import type { OutputItem } from '../types';

/**
 * Props for ModelReviewPanel
 */
interface ModelReviewPanelProps {
  /** Model ID to review */
  modelId: string;
  /** Called when panel is closed */
  onClose: () => void;
  /** Display mode: floating uses Rnd (drag/resize), embedded uses plain scrollable div */
  mode?: 'floating' | 'embedded';
  /** Called when output is added to main map (contours/GeoJSON) */
  onAddToMap?: (output: OutputItem, geoJson: GeoJSON.GeoJSON, modelInfo?: { modelId: string; modelName: string; engineType: string }) => void;
  /** Called when raster output is added to main map */
  onAddRasterToMap?: (output: OutputItem, bounds: [number, number, number, number], tileUrl: string, modelInfo?: { modelId: string; modelName: string; engineType: string }) => void;
}

/**
 * ModelReviewPanel displays full model results with preview capabilities.
 */
const DEFAULT_WIDTH = 730;
const DEFAULT_HEIGHT = 1070;
const MIN_WIDTH = 350;
const MIN_HEIGHT = 400;

export function ModelReviewPanel({
  modelId,
  onClose,
  mode = 'floating',
  onAddToMap,
  onAddRasterToMap,
}: ModelReviewPanelProps) {
  const api = useOpenNomad();
  const { results, isLoading, error, refetch } = useModelResults(modelId);
  const [previewOutput, setPreviewOutput] = useState<OutputItem | null>(null);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  // Calculate initial position (left side, below header)
  const [initialX] = useState(() => 180);
  const [initialY] = useState(() => 70);

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
    // Open download URL in new tab (via adapter for embedded mode support)
    window.open(api.results.getDownloadUrl(output.id), '_blank');
  }, [api]);

  /**
   * Handle add to map request from output list or preview modal
   * @param output The output item to add
   * @param mode Optional breaks mode for probability outputs ('static' or 'dynamic')
   */
  const handleAddToMap = useCallback(
    async (output: OutputItem, mode?: BreaksMode) => {
      if (!onAddToMap) return;

      try {
        // Use previewUrl from API response - backend returns correct URL for each output type
        // (regular results use /results/{id}/preview, perimeters use /models/{id}/perimeters)
        let previewUrl = output.previewUrl;

        // Add mode param for probability outputs
        if (mode) {
          const separator = previewUrl.includes('?') ? '&' : '?';
          previewUrl = `${previewUrl}${separator}mode=${mode}`;
        }

        // For embedded mode, transform URL if adapter provides transformer
        if (api.results.transformPreviewUrl) {
          previewUrl = api.results.transformPreviewUrl(previewUrl);
        }

        // Fetch the GeoJSON preview
        const response = await api.fetch(previewUrl);
        if (!response.ok) {
          let detail = `HTTP ${response.status}`;
          try {
            const body = await response.json();
            if (body?.error?.message) {
              detail = body.error.message;
            }
          } catch { /* response wasn't JSON */ }
          throw new Error(detail);
        }
        const geoJson = await response.json();
        // Pass model info for better layer naming
        const modelInfo = results ? {
          modelId: results.modelId,
          modelName: results.modelName,
          engineType: results.engineType,
          breaksMode: mode, // Include breaks mode in model info
        } : undefined;
        onAddToMap(output, geoJson, modelInfo);
      } catch (err) {
        console.error('Failed to add to map:', err);
        const message = err instanceof Error ? err.message : 'Unknown error';
        alert(`Failed to add to map: ${message}`);
      }
    },
    [api, onAddToMap, results]
  );

  /**
   * Close preview modal
   */
  const handleClosePreview = useCallback(() => {
    setPreviewOutput(null);
  }, []);

  /**
   * Open export panel
   */
  const handleExport = useCallback(() => {
    setShowExportPanel(true);
  }, []);

  /**
   * Close export panel
   */
  const handleCloseExport = useCallback(() => {
    setShowExportPanel(false);
  }, []);

  /**
   * Handle adding ignition geometry to map
   */
  const handleAddIgnitionToMap = useCallback(() => {
    if (!onAddToMap || !results?.inputs?.ignition) return;

    // Create a fake OutputItem for the ignition
    const ignitionOutput: OutputItem = {
      id: `ignition-${results.modelId}`,
      type: 'fire_perimeter' as OutputItem['type'],
      format: 'geojson',
      name: 'Ignition',
      timeOffsetHours: null,
      filePath: null,
      previewUrl: '',
      downloadUrl: '',
      metadata: {},
    };

    const modelInfo = {
      modelId: results.modelId,
      modelName: results.modelName,
      engineType: results.engineType,
    };

    onAddToMap(ignitionOutput, results.inputs.ignition.geojson as GeoJSON.GeoJSON, modelInfo);
  }, [onAddToMap, results]);

  /**
   * Handle adding raster tiles to map
   */
  const handleAddRasterToMap = useCallback(
    async (output: OutputItem) => {
      if (!onAddRasterToMap) return;

      try {
        // Get bounds and tile URL via adapter (supports embedded mode)
        const bounds = await api.results.getTileBounds(output.id);
        const tileUrl = api.results.getTileUrlTemplate(output.id);

        // Pass model info for layer naming
        const modelInfo = results ? {
          modelId: results.modelId,
          modelName: results.modelName,
          engineType: results.engineType,
        } : undefined;

        await onAddRasterToMap(output, bounds, tileUrl, modelInfo);
      } catch (err) {
        console.error('Failed to add raster to map:', err);
        alert('Failed to load raster data for map');
      }
    },
    [api, onAddRasterToMap, results]
  );

  // Render panel content based on state
  const renderContent = () => {
    // Loading state
    if (isLoading && !results) {
      return (
        <div style={loadingStyle}>
          <div style={spinnerStyle} />
          <div>Loading results...</div>
        </div>
      );
    }

    // Error state
    if (error && !results) {
      return (
        <div style={errorStyle}>
          <div style={errorIconStyle}>!</div>
          <div style={errorTextStyle}>Failed to load results</div>
          <div style={errorDetailStyle}>{error}</div>
          <button style={retryButtonStyle} onClick={refetch}>
            Try Again
          </button>
        </div>
      );
    }

    // No results
    if (!results) {
      return <div style={emptyStyle}>No results found for this model.</div>;
    }

    // Results content
    return (
      <div style={contentStyle}>
        <ResultsSummary
          modelId={results.modelId}
          modelName={results.modelName}
          engineType={results.engineType}
          userId={results.userId}
          summary={results.executionSummary}
          outputCount={results.outputs.length}
          inputs={results.inputs}
          outputConfig={results.outputConfig}
          onAddIgnitionToMap={handleAddIgnitionToMap}
        />
        <OutputList
          outputs={results.outputs}
          onPreview={handlePreview}
          onDownload={handleDownload}
          onAddToMap={handleAddToMap}
          onAddRasterToMap={onAddRasterToMap ? handleAddRasterToMap : undefined}
          onExport={handleExport}
        />
      </div>
    );
  };

  const renderHeader = () => {
    if (mode === 'embedded') {
      return (
        <div style={headerStyle}>
          <h2 style={titleStyle}>Model Results</h2>
          <button style={closeButtonStyle} onClick={onClose} aria-label="Close results panel">
            &times;
          </button>
        </div>
      );
    }
    return (
      <div style={headerStyle} className="model-results-drag-handle">
        <h2 style={titleStyle}>Model Results</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={dragHintStyle}>drag to move</span>
          <button style={closeButtonStyle} onClick={onClose} aria-label="Close results panel">
            &times;
          </button>
        </div>
      </div>
    );
  };

  const renderModals = () => (
    <>
      {previewOutput && (
        <OutputPreviewModal
          output={previewOutput}
          onClose={handleClosePreview}
          onAddToMap={handleAddToMap}
        />
      )}
      {showExportPanel && results && (
        <div style={exportModalOverlayStyle}>
          <ExportPanel
            modelId={modelId}
            modelName={results.modelName}
            outputs={results.outputs.map((o) => ({
              resultId: o.id,
              name: o.name,
              format: o.format,
              type: o.type,
            }))}
            onClose={handleCloseExport}
          />
        </div>
      )}
    </>
  );

  if (mode === 'embedded') {
    return (
      <>
        <div style={embeddedPanelStyle} data-testid="model-review-embedded">
          {renderHeader()}
          {renderContent()}
        </div>
        {renderModals()}
      </>
    );
  }

  return (
    <>
      <Rnd
        default={{
          x: initialX,
          y: initialY,
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
        }}
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        maxHeight={window.innerHeight - 32}
        bounds="parent"
        dragHandleClassName="model-results-drag-handle"
        style={{ zIndex: 1000 }}
        onResize={(_e, _dir, ref) => {
          setSize({
            width: ref.offsetWidth,
            height: ref.offsetHeight,
          });
        }}
        enableResizing={{
          top: false,
          right: true,
          bottom: true,
          left: true,
          topRight: false,
          bottomRight: true,
          bottomLeft: true,
          topLeft: false,
        }}
      >
        <div style={{ ...panelStyle, width: size.width, height: size.height }}>
          {renderHeader()}
          {renderContent()}
        </div>
      </Rnd>
      {renderModals()}
    </>
  );
}

const exportModalOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 2000,
};

// Styles
const panelStyle: React.CSSProperties = {
  backgroundColor: 'white',
  borderRadius: '12px',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid #e0e0e0',
  cursor: 'move',
  userSelect: 'none',
};

const dragHintStyle: React.CSSProperties = {
  fontSize: '10px',
  color: '#999',
  fontWeight: 'normal',
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

const embeddedPanelStyle: React.CSSProperties = {
  backgroundColor: 'white',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
};
