/**
 * Output List Component
 *
 * Displays a list of model outputs with view and download actions.
 */

import React, { useState } from 'react';
import type { OutputItem, OutputType, OutputFormat } from '../types';
import { BreaksSelectionModal, type BreaksMode } from './BreaksSelectionModal';

/**
 * Props for OutputList
 */
interface OutputListProps {
  /** List of outputs to display */
  outputs: OutputItem[];
  /** Called when preview is requested */
  onPreview: (output: OutputItem) => void;
  /** Called when download is requested */
  onDownload: (output: OutputItem) => void;
  /** Called when add to map is requested (with optional breaks mode) */
  onAddToMap: (output: OutputItem, mode?: BreaksMode) => void;
  /** Called when add raster to map is requested */
  onAddRasterToMap?: (output: OutputItem) => void;
  /** Called when export is requested */
  onExport?: () => void;
  /** Currently selected output */
  selectedOutput?: OutputItem | null;
}

// Re-export BreaksMode for consumers
export type { BreaksMode } from './BreaksSelectionModal';

/**
 * Get human readable output type name
 */
function getOutputTypeName(type: OutputType): string {
  switch (type) {
    case 'burn_probability':
      return 'Burn Probability';
    case 'fire_intensity':
      return 'Fire Intensity';
    case 'arrival_time':
      return 'Arrival Time';
    case 'fire_perimeter':
      return 'Fire Perimeter';
    case 'ember_density':
      return 'Ember Density';
    case 'weather_grid':
      return 'Weather Grid';
    case 'fuel_grid':
      return 'Fuel Grid';
    default:
      return type;
  }
}

/**
 * Get format badge color
 */
function getFormatColor(format: OutputFormat): string {
  switch (format) {
    case 'geotiff':
      return '#7b1fa2';
    case 'geojson':
      return '#1565c0';
    case 'kml':
      return '#2e7d32';
    case 'shapefile':
      return '#f57c00';
    case 'csv':
      return '#616161';
    default:
      return '#9e9e9e';
  }
}

/**
 * OutputList displays outputs with actions.
 */
export function OutputList({
  outputs,
  onPreview,
  onDownload,
  onAddToMap,
  onAddRasterToMap,
  onExport,
  selectedOutput,
}: OutputListProps) {
  // State for breaks selection modal
  const [pendingAddOutput, setPendingAddOutput] = useState<OutputItem | null>(null);

  // Handle add to map click - show modal for probability, direct add for others
  const handleAddToMapClick = (output: OutputItem) => {
    // Check for probability type (backend returns 'probability', frontend type may say 'burn_probability')
    if (output.type === 'burn_probability' || output.type === 'probability') {
      // Show modal for probability outputs
      setPendingAddOutput(output);
    } else {
      // Direct add for other output types
      onAddToMap(output);
    }
  };

  // Handle modal confirmation
  const handleBreaksModeConfirm = (mode: BreaksMode) => {
    if (pendingAddOutput) {
      onAddToMap(pendingAddOutput, mode);
      setPendingAddOutput(null);
    }
  };

  if (outputs.length === 0) {
    return (
      <div style={emptyStyle}>
        <div style={emptyTextStyle}>No outputs available</div>
        <div style={emptySubtextStyle}>
          Outputs will appear here when the model completes
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={containerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ ...headerStyle, margin: 0 }}>Model Outputs</h3>
          {onExport && outputs.length > 0 && (
            <button
              onClick={onExport}
              style={{
                padding: '6px 12px',
                fontSize: '13px',
                fontWeight: 500,
                backgroundColor: '#ff6b35',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Export All
            </button>
          )}
        </div>
        <div style={listStyle}>
          {outputs.map((output) => (
            <OutputListItem
              key={output.id}
              output={output}
              isSelected={selectedOutput?.id === output.id}
              onPreview={() => onPreview(output)}
              onDownload={() => onDownload(output)}
              onAddToMap={() => handleAddToMapClick(output)}
              onAddRasterToMap={onAddRasterToMap ? () => onAddRasterToMap(output) : undefined}
            />
          ))}
        </div>
      </div>

      {/* Breaks selection modal for probability outputs */}
      <BreaksSelectionModal
        isOpen={pendingAddOutput !== null}
        outputName={pendingAddOutput?.name ?? ''}
        onConfirm={handleBreaksModeConfirm}
        onCancel={() => setPendingAddOutput(null)}
      />
    </>
  );
}

/**
 * Single output item
 */
interface OutputListItemProps {
  output: OutputItem;
  isSelected: boolean;
  onPreview: () => void;
  onDownload: () => void;
  onAddToMap: () => void;
  onAddRasterToMap?: () => Promise<void> | void;
}

function OutputListItem({
  output,
  isSelected,
  onPreview,
  onDownload,
  onAddToMap,
  onAddRasterToMap,
}: OutputListItemProps) {
  const [isLoadingRaster, setIsLoadingRaster] = useState(false);
  const formatColor = getFormatColor(output.format);
  const canPreview = ['geotiff', 'geojson'].includes(output.format);

  const handleRasterClick = async () => {
    if (!onAddRasterToMap || isLoadingRaster) return;
    setIsLoadingRaster(true);
    try {
      await onAddRasterToMap();
    } finally {
      setIsLoadingRaster(false);
    }
  };

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '12px 16px',
    backgroundColor: isSelected ? '#e3f2fd' : 'white',
    borderRadius: '6px',
    border: isSelected ? '2px solid #1976d2' : '1px solid #e0e0e0',
    cursor: 'pointer',
    transition: 'all 0.2s',
  };

  const infoStyle: React.CSSProperties = {
    flex: '1 1 auto',
    minWidth: '100px',
    overflow: 'hidden',
  };

  const nameStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
  };

  const metaStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '4px',
  };

  const typeTagStyle: React.CSSProperties = {
    fontSize: '11px',
    color: '#666',
  };

  const formatTagStyle: React.CSSProperties = {
    fontSize: '10px',
    fontWeight: 500,
    padding: '2px 6px',
    borderRadius: '4px',
    backgroundColor: formatColor + '20',
    color: formatColor,
    textTransform: 'uppercase',
  };

  const actionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  };

  const buttonStyle: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: '12px',
    border: '1px solid #e0e0e0',
    borderRadius: '4px',
    backgroundColor: 'white',
    color: '#333',
    cursor: 'pointer',
    transition: 'all 0.2s',
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#1976d2',
    borderColor: '#1976d2',
    color: 'white',
  };

  return (
    <div style={itemStyle} onClick={canPreview ? onPreview : undefined}>
      <div style={infoStyle}>
        <div style={nameStyle} title={output.name}>
          {output.name}
        </div>
        <div style={metaStyle}>
          <span style={typeTagStyle}>{getOutputTypeName(output.type)}</span>
          <span style={formatTagStyle}>{output.format}</span>
          {output.timeOffsetHours !== null && (
            <span style={typeTagStyle}>T+{output.timeOffsetHours}h</span>
          )}
        </div>
      </div>
      <div style={actionsStyle} onClick={(e) => e.stopPropagation()}>
        {canPreview && (
          <button
            style={buttonStyle}
            onClick={onPreview}
            title="Preview on map"
          >
            View
          </button>
        )}
        <button
          style={buttonStyle}
          onClick={onDownload}
          title="Download file"
        >
          DL
        </button>

        {canPreview && (

          <button
            style={primaryButtonStyle}
            onClick={onAddToMap}
            title="Add contours to main map"
          >
            + Map
          </button>
        )}

        {output.format === 'geotiff' && onAddRasterToMap && (
          <button
            style={{
              ...buttonStyle,
              backgroundColor: '#7b1fa2',
              
              borderColor: '#7b1fa2',
              color: 'white',
              opacity: isLoadingRaster ? 0.7 : 1,
              cursor: isLoadingRaster ? 'wait' : 'pointer',
            }}
            onClick={handleRasterClick}
            disabled={isLoadingRaster}
            title="Add raster tiles to main map"
          >
            <i
              className={isLoadingRaster ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-table-cells'}
              style={{ marginRight: '4px' }}
            />
            {isLoadingRaster ? 'Loading...' : 'Raster'}
          </button>
        )}
      </div>
    </div>
  );
}

// Styles
const containerStyle: React.CSSProperties = {
  backgroundColor: 'white',
  borderRadius: '8px',
  border: '1px solid #e0e0e0',
  padding: '16px',
};

const headerStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#333',
  margin: '0 0 16px 0',
};

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const emptyStyle: React.CSSProperties = {
  backgroundColor: 'white',
  borderRadius: '8px',
  border: '1px solid #e0e0e0',
  padding: '40px 20px',
  textAlign: 'center',
};

const emptyTextStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 500,
  color: '#333',
  marginBottom: '8px',
};

const emptySubtextStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#666',
};
