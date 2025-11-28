/**
 * Output List Component
 *
 * Displays a list of model outputs with view and download actions.
 */

import React from 'react';
import type { OutputItem, OutputType, OutputFormat } from '../types';

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
  /** Called when add to map is requested */
  onAddToMap: (output: OutputItem) => void;
  /** Currently selected output */
  selectedOutput?: OutputItem | null;
}

/**
 * Get icon for output type
 */
function getOutputIcon(type: OutputType): string {
  switch (type) {
    case 'burn_probability':
      return '\uD83D\uDD25'; // fire
    case 'fire_intensity':
      return '\uD83C\uDF21'; // thermometer
    case 'arrival_time':
      return '\u23F1'; // stopwatch
    case 'fire_perimeter':
      return '\u2B55'; // circle
    case 'ember_density':
      return '\u2728'; // sparkles
    case 'weather_grid':
      return '\uD83C\uDF26'; // cloud
    case 'fuel_grid':
      return '\uD83C\uDF32'; // tree
    default:
      return '\uD83D\uDCC4'; // document
  }
}

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
  selectedOutput,
}: OutputListProps) {
  if (outputs.length === 0) {
    return (
      <div style={emptyStyle}>
        <div style={emptyIconStyle}>\uD83D\uDCC2</div>
        <div style={emptyTextStyle}>No outputs available</div>
        <div style={emptySubtextStyle}>
          Outputs will appear here when the model completes
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h3 style={headerStyle}>Model Outputs</h3>
      <div style={listStyle}>
        {outputs.map((output) => (
          <OutputListItem
            key={output.id}
            output={output}
            isSelected={selectedOutput?.id === output.id}
            onPreview={() => onPreview(output)}
            onDownload={() => onDownload(output)}
            onAddToMap={() => onAddToMap(output)}
          />
        ))}
      </div>
    </div>
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
}

function OutputListItem({
  output,
  isSelected,
  onPreview,
  onDownload,
  onAddToMap,
}: OutputListItemProps) {
  const formatColor = getFormatColor(output.format);
  const canPreview = ['geotiff', 'geojson'].includes(output.format);

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    backgroundColor: isSelected ? '#e3f2fd' : 'white',
    borderRadius: '6px',
    border: isSelected ? '2px solid #1976d2' : '1px solid #e0e0e0',
    cursor: 'pointer',
    transition: 'all 0.2s',
  };

  const iconStyle: React.CSSProperties = {
    fontSize: '24px',
    width: '32px',
    textAlign: 'center',
  };

  const infoStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
  };

  const nameStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 500,
    color: '#333',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
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
      <span style={iconStyle}>{getOutputIcon(output.type)}</span>
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
            \uD83D\uDC41
          </button>
        )}
        <button
          style={buttonStyle}
          onClick={onDownload}
          title="Download file"
        >
          \u2B07
        </button>
        {canPreview && (
          <button
            style={primaryButtonStyle}
            onClick={onAddToMap}
            title="Add to main map"
          >
            + Map
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

const emptyIconStyle: React.CSSProperties = {
  fontSize: '48px',
  marginBottom: '16px',
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
