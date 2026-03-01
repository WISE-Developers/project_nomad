/**
 * ModelSelectionStep Component
 *
 * Third wizard step for selecting fire modeling engine and run type.
 */

import React, { useCallback } from 'react';
import { useWizardData } from '../../Wizard';
import type { ModelSetupData, FireEngine, OutputMode } from '../types';

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '32px',
  padding: '16px',
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 'bold',
  color: '#333',
};

const optionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  flexWrap: 'wrap',
};

const optionCardStyle: React.CSSProperties = {
  flex: '1 1 200px',
  padding: '16px',
  border: '2px solid #ddd',
  borderRadius: '8px',
  cursor: 'pointer',
  transition: 'border-color 0.2s, background-color 0.2s',
};

const selectedCardStyle: React.CSSProperties = {
  ...optionCardStyle,
  border: '2px solid #ff6b35',
  backgroundColor: 'rgba(255, 107, 53, 0.05)',
};

const disabledCardStyle: React.CSSProperties = {
  ...optionCardStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
  backgroundColor: '#f5f5f5',
};

const optionTitleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 'bold',
  marginBottom: '8px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  color: '#333',
};

const optionDescStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#666',
  lineHeight: 1.5,
};

const badgeStyle: React.CSSProperties = {
  fontSize: '10px',
  padding: '2px 6px',
  borderRadius: '4px',
  fontWeight: 'bold',
};

const radioStyle: React.CSSProperties = {
  display: 'none', // Hidden, the card is the clickable element
};

interface EngineOption {
  id: FireEngine;
  name: string;
  icon: string;
  description: string;
  available: boolean;
}

interface OutputModeOption {
  id: OutputMode;
  name: string;
  icon: string;
  description: string;
}

const engines: EngineOption[] = [
  {
    id: 'firestarr',
    name: 'FireSTARR',
    icon: 'fire',
    description:
      'Stochastic fire spread model optimized for Canadian boreal forests. Provides probability-based fire perimeters and intensity predictions.',
    available: true,
  },
  {
    id: 'wise',
    name: 'Additional Engine',
    icon: 'puzzle-piece',
    description: 'Future fire modeling engine integration. Additional engines can be added to Nomad through the engine abstraction layer.',
    available: false,
  },
];

const outputModes: OutputModeOption[] = [
  {
    id: 'probabilistic',
    name: 'Probability Maps',
    icon: 'chart-simple',
    description:
      'Output daily probability rasters showing fire spread likelihood at each location.',
  },
  {
    id: 'pseudo-deterministic',
    name: 'Fire Perimeters',
    icon: 'draw-polygon',
    description:
      'Output daily fire perimeter polygons at a confidence threshold (e.g., 50% probability).',
  },
];

/**
 * Model Selection Step component
 */
export function ModelSelectionStep() {
  const { data, setField } = useWizardData<ModelSetupData>();

  const model = data.model ?? {
    engine: 'firestarr',
    runType: 'deterministic',
    outputMode: 'probabilistic',
  };

  // Update engine selection
  const handleEngineChange = useCallback(
    (engine: FireEngine) => {
      // Only allow selection of available engines
      const engineOption = engines.find((e) => e.id === engine);
      if (!engineOption?.available) return;

      setField('model', {
        ...model,
        engine,
      });
    },
    [setField, model]
  );

  // Update output mode selection
  const handleOutputModeChange = useCallback(
    (outputMode: OutputMode) => {
      setField('model', {
        ...model,
        outputMode,
      });
    },
    [setField, model]
  );

  return (
    <div style={containerStyle}>
      {/* Engine Selection */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Fire Modeling Engine</label>
        <div style={optionsStyle}>
          {engines.map((engine) => {
            const isSelected = model.engine === engine.id;
            const cardStyle = !engine.available
              ? disabledCardStyle
              : isSelected
                ? selectedCardStyle
                : optionCardStyle;

            return (
              <div
                key={engine.id}
                style={cardStyle}
                onClick={() => handleEngineChange(engine.id)}
                role="radio"
                aria-checked={isSelected}
                tabIndex={engine.available ? 0 : -1}
              >
                <input
                  type="radio"
                  name="engine"
                  value={engine.id}
                  checked={isSelected}
                  onChange={() => handleEngineChange(engine.id)}
                  disabled={!engine.available}
                  style={radioStyle}
                />
                <div style={optionTitleStyle}>
                  <i className={`fa-solid fa-${engine.icon}`} />
                  <span>{engine.name}</span>
                  {!engine.available && (
                    <span style={{ ...badgeStyle, backgroundColor: '#95a5a6', color: 'white' }}>
                      Coming Soon
                    </span>
                  )}
                  {engine.available && isSelected && (
                    <span style={{ ...badgeStyle, backgroundColor: '#ff6b35', color: 'white' }}>
                      Selected
                    </span>
                  )}
                </div>
                <div style={optionDescStyle}>{engine.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Output Mode Selection */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Output Mode</label>
        <div style={optionsStyle}>
          {outputModes.map((outputMode) => {
            const isSelected = model.outputMode === outputMode.id;
            const cardStyle = isSelected ? selectedCardStyle : optionCardStyle;

            return (
              <div
                key={outputMode.id}
                style={cardStyle}
                onClick={() => handleOutputModeChange(outputMode.id)}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
              >
                <input
                  type="radio"
                  name="outputMode"
                  value={outputMode.id}
                  checked={isSelected}
                  onChange={() => handleOutputModeChange(outputMode.id)}
                  style={radioStyle}
                />
                <div style={optionTitleStyle}>
                  <i className={`fa-solid fa-${outputMode.icon}`} />
                  <span>{outputMode.name}</span>
                  {isSelected && (
                    <span style={{ ...badgeStyle, backgroundColor: '#ff6b35', color: 'white' }}>
                      Selected
                    </span>
                  )}
                </div>
                <div style={optionDescStyle}>{outputMode.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Info box for probability maps */}
      {model.outputMode === 'probabilistic' && (
        <div
          style={{
            padding: '12px',
            backgroundColor: '#ebf5fb',
            borderRadius: '4px',
            fontSize: '13px',
            borderLeft: '4px solid #3498db',
            color: '#333',
          }}
        >
          <strong>Note:</strong> Probability maps show the likelihood of fire spread at each location
          over time. These raster outputs are ideal for risk analysis and can be visualized with color
          gradients representing burn probability.
        </div>
      )}

    </div>
  );
}
