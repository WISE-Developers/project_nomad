/**
 * Breaks Selection Modal
 *
 * Modal dialog for selecting quantile breaks mode when adding
 * probability outputs to the map.
 */

import React, { useState } from 'react';

export type BreaksMode = 'static' | 'dynamic';

interface BreaksSelectionModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Output name being added */
  outputName: string;
  /** Called when user confirms selection */
  onConfirm: (mode: BreaksMode) => void;
  /** Called when user cancels */
  onCancel: () => void;
}

/**
 * Modal for selecting Static or Dynamic quantile breaks mode
 */
export function BreaksSelectionModal({
  isOpen,
  outputName,
  onConfirm,
  onCancel,
}: BreaksSelectionModalProps) {
  const [selectedMode, setSelectedMode] = useState<BreaksMode>('static');

  if (!isOpen) return null;

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={titleStyle}>Add to Map</h3>
        <p style={subtitleStyle}>
          Choose how to display <strong>{outputName}</strong>
        </p>

        <div style={optionsContainerStyle}>
          {/* Static Option */}
          <label
            style={{
              ...optionStyle,
              ...(selectedMode === 'static' ? selectedOptionStyle : {}),
            }}
          >
            <input
              type="radio"
              name="breaksMode"
              value="static"
              checked={selectedMode === 'static'}
              onChange={() => setSelectedMode('static')}
              style={radioStyle}
            />
            <div style={optionContentStyle}>
              <div style={optionHeaderStyle}>
                <span style={optionTitleStyle}>Static (Standardized)</span>
                <span style={helpIconStyle} title="Fixed 10% probability intervals. Colors are consistent across all models, making it easy to compare different outputs.">
                  ?
                </span>
              </div>
              <p style={optionDescStyle}>
                Fixed 10% intervals - consistent colors across all models for easy comparison
              </p>
              <div style={colorBarStyle}>
                {['#00B1F2', '#FAF68E', '#FCDF4B', '#FAC044', '#F5A23D', '#F28938', '#F06C33', '#EE4F2C', '#EB3326', '#E6151F'].map((color, i) => (
                  <div key={i} style={{ ...colorSwatchStyle, backgroundColor: color }} title={`${(i + 1) * 10}%`} />
                ))}
              </div>
            </div>
          </label>

          {/* Dynamic Option */}
          <label
            style={{
              ...optionStyle,
              ...(selectedMode === 'dynamic' ? selectedOptionStyle : {}),
            }}
          >
            <input
              type="radio"
              name="breaksMode"
              value="dynamic"
              checked={selectedMode === 'dynamic'}
              onChange={() => setSelectedMode('dynamic')}
              style={radioStyle}
            />
            <div style={optionContentStyle}>
              <div style={optionHeaderStyle}>
                <span style={optionTitleStyle}>Dynamic (Custom)</span>
                <span style={helpIconStyle} title="Quantile breaks calculated from this specific output. Shows more detail but colors vary between outputs.">
                  ?
                </span>
              </div>
              <p style={optionDescStyle}>
                Quantile breaks from this output - shows more detail within this specific result
              </p>
              <div style={colorBarStyle}>
                {['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#b10026'].map((color, i) => (
                  <div key={i} style={{ ...colorSwatchStyle, backgroundColor: color }} />
                ))}
              </div>
            </div>
          </label>
        </div>

        <div style={actionsStyle}>
          <button style={cancelButtonStyle} onClick={onCancel}>
            Cancel
          </button>
          <button style={confirmButtonStyle} onClick={() => onConfirm(selectedMode)}>
            Add to Map
          </button>
        </div>
      </div>
    </div>
  );
}

// Styles
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10000,
};

const modalStyle: React.CSSProperties = {
  backgroundColor: 'white',
  borderRadius: '12px',
  padding: '24px',
  width: '100%',
  maxWidth: '480px',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 4px 0',
  fontSize: '20px',
  fontWeight: 600,
  color: '#333',
};

const subtitleStyle: React.CSSProperties = {
  margin: '0 0 20px 0',
  fontSize: '14px',
  color: '#666',
};

const optionsContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  marginBottom: '24px',
};

const optionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '12px',
  padding: '16px',
  border: '2px solid #e0e0e0',
  borderRadius: '8px',
  cursor: 'pointer',
  transition: 'all 0.2s',
};

const selectedOptionStyle: React.CSSProperties = {
  borderColor: '#1976d2',
  backgroundColor: '#e3f2fd',
};

const radioStyle: React.CSSProperties = {
  marginTop: '4px',
  width: '18px',
  height: '18px',
  accentColor: '#1976d2',
};

const optionContentStyle: React.CSSProperties = {
  flex: 1,
};

const optionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '4px',
};

const optionTitleStyle: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  color: '#333',
};

const helpIconStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '18px',
  height: '18px',
  fontSize: '12px',
  fontWeight: 600,
  color: '#666',
  backgroundColor: '#f0f0f0',
  borderRadius: '50%',
  cursor: 'help',
};

const optionDescStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: '13px',
  color: '#666',
  lineHeight: 1.4,
};

const colorBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: '2px',
  marginTop: '8px',
};

const colorSwatchStyle: React.CSSProperties = {
  flex: 1,
  height: '12px',
  borderRadius: '2px',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: '14px',
  fontWeight: 500,
  backgroundColor: 'white',
  color: '#333',
  border: '1px solid #e0e0e0',
  borderRadius: '6px',
  cursor: 'pointer',
};

const confirmButtonStyle: React.CSSProperties = {
  padding: '10px 20px',
  fontSize: '14px',
  fontWeight: 500,
  backgroundColor: '#1976d2',
  color: 'white',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
};
