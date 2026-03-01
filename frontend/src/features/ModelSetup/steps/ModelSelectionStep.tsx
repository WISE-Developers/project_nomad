/**
 * ModelSelectionStep Component
 *
 * Third wizard step for selecting fire modeling engine and model mode.
 */

import React, { useCallback } from 'react';
import { useWizardData } from '../../Wizard';
import type { ModelSetupData, FireEngine, ModelMode } from '../types';

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

interface ModelModeOption {
  id: ModelMode;
  name: string;
  icon: string;
  description: string;
  available: boolean;
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

const modelModes: ModelModeOption[] = [
  {
    id: 'probabilistic',
    name: 'Probabilistic',
    icon: 'chart-simple',
    description:
      'Run multiple stochastic scenarios to generate daily probability rasters showing fire spread likelihood at each location.',
    available: true,
  },
  {
    id: 'deterministic',
    name: 'Deterministic',
    icon: 'draw-polygon',
    description:
      'Run a single scenario to produce daily fire perimeter polygons at a defined confidence threshold.',
    available: false,
  },
  {
    id: 'long-term-risk',
    name: 'Long-Term Risk',
    icon: 'calendar-days',
    description:
      'Assess burn probability over an extended season to support strategic planning and resource allocation.',
    available: false,
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
    modelMode: 'probabilistic',
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

  // Update model mode selection
  const handleModelModeChange = useCallback(
    (modelMode: ModelMode) => {
      // Only allow selection of available modes
      const modeOption = modelModes.find((m) => m.id === modelMode);
      if (!modeOption?.available) return;

      // Derive outputMode from modelMode
      const outputMode = modelMode === 'deterministic' ? 'pseudo-deterministic' : 'probabilistic';

      setField('model', {
        ...model,
        modelMode,
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

      {/* Model Mode Selection */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Model Mode</label>
        <div style={optionsStyle}>
          {modelModes.map((mode) => {
            const isSelected = (model.modelMode ?? 'probabilistic') === mode.id;
            const cardStyle = !mode.available
              ? disabledCardStyle
              : isSelected
                ? selectedCardStyle
                : optionCardStyle;

            return (
              <div
                key={mode.id}
                style={cardStyle}
                onClick={() => handleModelModeChange(mode.id)}
                role="radio"
                aria-checked={isSelected}
                {...(!mode.available ? { 'aria-disabled': true } : {})}
                tabIndex={mode.available ? 0 : -1}
              >
                <input
                  type="radio"
                  name="modelMode"
                  value={mode.id}
                  checked={isSelected}
                  onChange={() => handleModelModeChange(mode.id)}
                  disabled={!mode.available}
                  style={radioStyle}
                />
                <div style={optionTitleStyle}>
                  <i className={`fa-solid fa-${mode.icon}`} />
                  <span>{mode.name}</span>
                  {!mode.available && (
                    <span style={{ ...badgeStyle, backgroundColor: '#95a5a6', color: 'white' }}>
                      Coming Soon
                    </span>
                  )}
                  {mode.available && isSelected && (
                    <span style={{ ...badgeStyle, backgroundColor: '#ff6b35', color: 'white' }}>
                      Selected
                    </span>
                  )}
                </div>
                <div style={optionDescStyle}>{mode.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Info box for probabilistic mode */}
      {(model.modelMode ?? 'probabilistic') === 'probabilistic' && (
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
          <strong>Note:</strong> Probabilistic mode runs multiple stochastic scenarios to generate
          probability maps showing the likelihood of fire spread at each location over time. These
          raster outputs are ideal for risk analysis and can be visualized with color gradients
          representing burn probability.
        </div>
      )}
    </div>
  );
}
