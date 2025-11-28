/**
 * WeatherStep Component
 *
 * Fourth wizard step for entering weather/FWI data.
 */

import React, { useState, useCallback } from 'react';
import { useWizardData, useWizardValidation } from '../../Wizard';
import { FWIInput } from '../components/FWIInput';
import { WeatherUpload } from '../components/WeatherUpload';
import type { ModelSetupData, WeatherSource, FWIValues } from '../types';

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  padding: '16px',
};

const tabsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
  borderBottom: '1px solid #ddd',
  paddingBottom: '8px',
};

const tabStyle: React.CSSProperties = {
  padding: '10px 20px',
  border: 'none',
  background: 'none',
  cursor: 'pointer',
  fontSize: '14px',
  color: '#666',
  borderRadius: '4px 4px 0 0',
  transition: 'background-color 0.2s',
};

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  backgroundColor: '#ff6b35',
  color: 'white',
};

const disabledTabStyle: React.CSSProperties = {
  ...tabStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

const contentStyle: React.CSSProperties = {
  minHeight: '300px',
};

interface Tab {
  id: WeatherSource;
  label: string;
  icon: string;
  disabled: boolean;
}

const tabs: Tab[] = [
  { id: 'manual', label: 'Manual FWI Entry', icon: '✏️', disabled: false },
  { id: 'upload', label: 'Upload Weather File', icon: '📁', disabled: true },
  { id: 'spotwx', label: 'SpotWX Forecast', icon: '🌤️', disabled: true },
];

/**
 * Weather Step component
 */
export function WeatherStep() {
  const { data, setField } = useWizardData<ModelSetupData>();
  const { getErrors } = useWizardValidation();

  const weather = data.weather ?? { source: 'manual' };
  const [activeTab, setActiveTab] = useState<WeatherSource>(weather.source);

  // Get field errors from validation
  const errors = getErrors();
  const fieldErrors: Record<string, string> = {};
  for (const error of errors) {
    if (error.field) {
      fieldErrors[error.field] = error.message;
    }
  }

  // Handle tab change
  const handleTabChange = useCallback(
    (source: WeatherSource) => {
      const tab = tabs.find((t) => t.id === source);
      if (tab?.disabled) return;

      setActiveTab(source);
      setField('weather', {
        ...weather,
        source,
      });
    },
    [setField, weather]
  );

  // Handle FWI value changes
  const handleFWIChange = useCallback(
    (fwi: FWIValues) => {
      setField('weather', {
        ...weather,
        source: 'manual',
        fwi,
      });
    },
    [setField, weather]
  );

  // Handle file upload
  const handleFileUpload = useCallback(
    (fileName: string) => {
      setField('weather', {
        ...weather,
        source: 'upload',
        uploadedFile: fileName,
      });
    },
    [setField, weather]
  );

  return (
    <div style={containerStyle}>
      {/* Tab navigation */}
      <div style={tabsStyle}>
        {tabs.map((tab) => {
          let style = tabStyle;
          if (tab.disabled) {
            style = disabledTabStyle;
          } else if (activeTab === tab.id) {
            style = activeTabStyle;
          }

          return (
            <button
              key={tab.id}
              style={style}
              onClick={() => handleTabChange(tab.id)}
              disabled={tab.disabled}
            >
              {tab.icon} {tab.label}
              {tab.disabled && (
                <span
                  style={{
                    marginLeft: '8px',
                    fontSize: '10px',
                    backgroundColor: '#95a5a6',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '4px',
                  }}
                >
                  Soon
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={contentStyle}>
        {activeTab === 'manual' && (
          <FWIInput values={weather.fwi ?? {}} onChange={handleFWIChange} errors={fieldErrors} />
        )}

        {activeTab === 'upload' && <WeatherUpload onUpload={handleFileUpload} />}

        {activeTab === 'spotwx' && (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              backgroundColor: '#ebf5fb',
              borderRadius: '8px',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌤️</div>
            <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>
              SpotWX Integration
            </div>
            <div style={{ fontSize: '14px', color: '#555' }}>
              Automatic weather data from SpotWX forecast models is coming soon. This will
              automatically fetch weather data based on your selected location and time range.
            </div>
          </div>
        )}
      </div>

      {/* Info box */}
      <div
        style={{
          padding: '12px',
          backgroundColor: '#fff3cd',
          borderRadius: '4px',
          borderLeft: '4px solid #ffc107',
          fontSize: '13px',
          color: '#333',
        }}
      >
        <strong>Tip:</strong> If you don't have current FWI values, you can use the "Spring Startup
        Values" button to populate typical early-season conditions. For active fire situations,
        contact your local fire weather forecaster for current indices.
      </div>
    </div>
  );
}
