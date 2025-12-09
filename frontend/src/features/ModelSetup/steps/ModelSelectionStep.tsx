/**
 * ModelSelectionStep Component
 *
 * Third wizard step for selecting fire modeling engine and run type.
 */

import React, { useCallback } from 'react';
import { useWizardData } from '../../Wizard';
import type { ModelSetupData, FireEngine, RunType } from '../types';

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

interface RunTypeOption {
  id: RunType;
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
    name: 'WISE',
    icon: 'tree',
    description:
      'Wildfire Intelligence Simulation Engine. Advanced physics-based fire behavior modeling with detailed fire intensity outputs.',
    available: false,
  },
];

const runTypes: RunTypeOption[] = [
  {
    id: 'deterministic',
    name: 'Deterministic',
    icon: 'arrow-right',
    description:
      'Single simulation run with fixed parameters. Faster execution, produces a single fire perimeter prediction.',
  },
  {
    id: 'probabilistic',
    name: 'Probabilistic',
    icon: 'chart-bar',
    description:
      'Multiple simulation runs with varied parameters. Longer execution time, produces burn probability maps showing fire likelihood.',
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

  // Update run type selection
  const handleRunTypeChange = useCallback(
    (runType: RunType) => {
      setField('model', {
        ...model,
        runType,
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

      {/* Run Type Selection */}
      <div style={sectionStyle}>
        <label style={labelStyle}>Run Type</label>
        <div style={optionsStyle}>
          {runTypes.map((runType) => {
            const isSelected = model.runType === runType.id;
            const cardStyle = isSelected ? selectedCardStyle : optionCardStyle;

            return (
              <div
                key={runType.id}
                style={cardStyle}
                onClick={() => handleRunTypeChange(runType.id)}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
              >
                <input
                  type="radio"
                  name="runType"
                  value={runType.id}
                  checked={isSelected}
                  onChange={() => handleRunTypeChange(runType.id)}
                  style={radioStyle}
                />
                <div style={optionTitleStyle}>
                  <i className={`fa-solid fa-${runType.icon}`} />
                  <span>{runType.name}</span>
                  {isSelected && (
                    <span style={{ ...badgeStyle, backgroundColor: '#ff6b35', color: 'white' }}>
                      Selected
                    </span>
                  )}
                </div>
                <div style={optionDescStyle}>{runType.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Info box for probabilistic */}
      {model.runType === 'probabilistic' && (
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
          <strong>Note:</strong> Probabilistic runs execute multiple simulations (typically 100+) to
          generate burn probability maps. This can take significantly longer than deterministic runs
          but provides uncertainty quantification.
        </div>
      )}
    </div>
  );
}
