import { useMeasurement } from '../hooks/useMeasurement';

/**
 * Props for MeasurementTool component
 */
interface MeasurementToolProps {
  /** Position on the map */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** CSS class for additional styling */
  className?: string;
}

/**
 * Position style mapping
 */
const POSITION_STYLES: Record<string, React.CSSProperties> = {
  'top-left': { top: '10px', left: '200px' },
  'top-right': { top: '10px', right: '10px' },
  'bottom-left': { bottom: '30px', left: '200px' },
  'bottom-right': { bottom: '30px', right: '10px' },
};

/**
 * MeasurementTool provides UI for measuring distances and areas on the map.
 *
 * Features:
 * - Distance measurement (draw a line)
 * - Area measurement (draw a polygon)
 * - Results displayed in metric units
 * - Clear button to reset
 *
 * @example
 * ```tsx
 * <MapContainer>
 *   <MeasurementTool position="top-left" />
 * </MapContainer>
 * ```
 */
export function MeasurementTool({
  position = 'top-left',
  className = '',
}: MeasurementToolProps) {
  const { mode, result, measureDistance, measureArea, clear, isActive } = useMeasurement();

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    zIndex: 1,
    backgroundColor: 'white',
    borderRadius: '4px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
    padding: '8px',
    minWidth: '180px',
    ...POSITION_STYLES[position],
  };

  const buttonContainerStyle: React.CSSProperties = {
    display: 'flex',
    gap: '4px',
    marginBottom: result ? '8px' : 0,
  };

  const buttonStyle: React.CSSProperties = {
    flex: 1,
    padding: '8px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    backgroundColor: 'white',
    transition: 'background-color 0.2s',
  };

  const activeButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#e3f2fd',
    borderColor: '#2196f3',
  };

  const resultStyle: React.CSSProperties = {
    padding: '8px',
    backgroundColor: '#f5f5f5',
    borderRadius: '4px',
    fontSize: '14px',
  };

  const resultValueStyle: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 600,
    color: '#1976d2',
    marginBottom: '4px',
  };

  const resultLabelStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#666',
  };

  const clearButtonStyle: React.CSSProperties = {
    width: '100%',
    marginTop: '8px',
    padding: '6px',
    border: '1px solid #ffcdd2',
    borderRadius: '4px',
    backgroundColor: 'white',
    color: '#d32f2f',
    cursor: 'pointer',
    fontSize: '12px',
  };

  return (
    <div className={`measurement-tool ${className}`} style={containerStyle}>
      <div style={buttonContainerStyle}>
        <button
          style={mode === 'distance' ? activeButtonStyle : buttonStyle}
          onClick={measureDistance}
          title="Measure distance"
        >
          <span style={{ fontSize: '16px' }}>📏</span>
          <span>Distance</span>
        </button>
        <button
          style={mode === 'area' ? activeButtonStyle : buttonStyle}
          onClick={measureArea}
          title="Measure area"
        >
          <span style={{ fontSize: '16px' }}>⬛</span>
          <span>Area</span>
        </button>
      </div>

      {result && (
        <div style={resultStyle}>
          <div style={resultValueStyle}>{result.formatted}</div>
          <div style={resultLabelStyle}>
            {result.type === 'distance' ? 'Total distance' : 'Total area'}
          </div>
          {result.perimeter && (
            <div style={{ ...resultLabelStyle, marginTop: '4px' }}>
              Perimeter: {result.perimeter}
            </div>
          )}
        </div>
      )}

      {isActive && (
        <button style={clearButtonStyle} onClick={clear}>
          Clear Measurement
        </button>
      )}

      {mode !== 'none' && !result && (
        <div style={{ ...resultLabelStyle, marginTop: '8px', textAlign: 'center' }}>
          {mode === 'distance'
            ? 'Click points to measure distance'
            : 'Click points to draw area'}
        </div>
      )}
    </div>
  );
}
