/**
 * WeatherStep Component
 *
 * Fourth wizard step for entering weather data.
 * Supports three input methods:
 * 1. FireSTARR CSV - Pre-calculated weather with FWI indices
 * 2. Raw Weather + Codes - Raw weather data with starting codes (backend calculates FWI)
 * 3. SpotWX - Automatic weather from forecast models (Predictive Modelling only)
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useWizardData } from '../../Wizard';
import { FirestarrCsvUpload } from '../components/FirestarrCsvUpload';
import { RawWeatherUpload } from '../components/RawWeatherUpload';
import type { ModelSetupData, WeatherSource, ParsedWeatherCSV, FWIStartingCodes } from '../types';

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
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
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

const badgeStyle: React.CSSProperties = {
  fontSize: '10px',
  backgroundColor: '#95a5a6',
  color: 'white',
  padding: '2px 6px',
  borderRadius: '4px',
};

const retroactiveBadgeStyle: React.CSSProperties = {
  ...badgeStyle,
  backgroundColor: '#9b59b6',
};

interface Tab {
  id: WeatherSource;
  label: string;
  icon: string;
  disabledReason?: string;
}

/**
 * Weather Step component
 */
export function WeatherStep() {
  const { data, setField } = useWizardData<ModelSetupData>();

  // Get temporal data to determine modelling mode
  const temporal = data.temporal ?? { isForecast: false };
  const isForecast = temporal.isForecast;

  // Define tabs based on modelling mode
  const tabs: Tab[] = useMemo(
    () => [
      {
        id: 'firestarr_csv' as WeatherSource,
        label: 'FireSTARR CSV',
        icon: '!',
      },
      {
        id: 'raw_weather' as WeatherSource,
        label: 'Raw Weather + Codes',
        icon: '!',
      },
      {
        id: 'spotwx' as WeatherSource,
        label: 'SpotWX',
        icon: '!',
        disabledReason: isForecast ? undefined : 'Only available for Predictive Modelling',
      },
    ],
    [isForecast]
  );

  const weather = data.weather ?? { source: 'firestarr_csv' };
  const [activeTab, setActiveTab] = useState<WeatherSource>(weather.source);

  // Handle tab change
  const handleTabChange = useCallback(
    (source: WeatherSource) => {
      const tab = tabs.find((t) => t.id === source);
      if (tab?.disabledReason) return;

      setActiveTab(source);
      setField('weather', {
        ...weather,
        source,
      });
    },
    [setField, weather, tabs]
  );

  // Handle FireSTARR CSV upload
  const handleFirestarrUpload = useCallback(
    (file: File, parsed: ParsedWeatherCSV) => {
      setField('weather', {
        ...weather,
        source: 'firestarr_csv',
        firestarrCsvFile: file,
        firestarrCsvFileName: file.name,
        firestarrCsvParsed: parsed,
      });
    },
    [setField, weather]
  );

  // Handle Raw Weather file upload
  const handleRawWeatherUpload = useCallback(
    (file: File, parsed: ParsedWeatherCSV) => {
      setField('weather', {
        ...weather,
        source: 'raw_weather',
        rawWeatherFile: file,
        rawWeatherFileName: file.name,
        rawWeatherParsed: parsed,
      });
    },
    [setField, weather]
  );

  // Handle Starting Codes change
  const handleStartingCodesChange = useCallback(
    (codes: FWIStartingCodes) => {
      setField('weather', {
        ...weather,
        source: 'raw_weather',
        startingCodes: codes,
      });
    },
    [setField, weather]
  );

  return (
    <div style={containerStyle}>
      {/* Modelling mode indicator */}
      <div
        style={{
          padding: '8px 12px',
          backgroundColor: isForecast ? '#ebf5fb' : '#f5eef8',
          borderRadius: '4px',
          fontSize: '13px',
          color: '#333',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={isForecast ? badgeStyle : retroactiveBadgeStyle}>
          {isForecast ? 'Predictive' : 'Retroactive'}
        </span>
        {isForecast ? (
          <>Weather data can be fetched automatically via SpotWX or uploaded manually.</>
        ) : (
          <>You must upload weather data for retroactive modelling.</>
        )}
      </div>

      {/* Tab navigation */}
      <div style={tabsStyle}>
        {tabs.map((tab) => {
          const isDisabled = !!tab.disabledReason;
          let style = tabStyle;
          if (isDisabled) {
            style = disabledTabStyle;
          } else if (activeTab === tab.id) {
            style = activeTabStyle;
          }

          return (
            <button
              key={tab.id}
              style={style}
              onClick={() => handleTabChange(tab.id)}
              disabled={isDisabled}
              title={tab.disabledReason}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {isDisabled && (
                <span style={badgeStyle}>
                  Forecast Only
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={contentStyle}>
        {activeTab === 'firestarr_csv' && (
          <FirestarrCsvUpload
            onUpload={handleFirestarrUpload}
            fileName={weather.firestarrCsvFileName}
            parsed={weather.firestarrCsvParsed}
          />
        )}

        {activeTab === 'raw_weather' && (
          <RawWeatherUpload
            onFileUpload={handleRawWeatherUpload}
            onStartingCodesChange={handleStartingCodesChange}
            fileName={weather.rawWeatherFileName}
            parsed={weather.rawWeatherParsed}
            startingCodes={weather.startingCodes}
          />
        )}

        {activeTab === 'spotwx' && (
          <div
            style={{
              padding: '32px',
              textAlign: 'center',
              backgroundColor: '#ebf5fb',
              borderRadius: '8px',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>!</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>
              SpotWX Integration
            </div>
            <div style={{ fontSize: '14px', color: '#555', maxWidth: '500px', margin: '0 auto' }}>
              Weather data will be automatically fetched from SpotWX forecast models based on your
              selected location and time range. This feature uses high-resolution weather forecasts
              optimized for fire behavior prediction.
            </div>
            <div
              style={{
                marginTop: '24px',
                padding: '12px',
                backgroundColor: '#fff',
                borderRadius: '4px',
                fontSize: '13px',
                color: '#666',
              }}
            >
              <strong>Note:</strong> SpotWX integration is under development. Full implementation
              coming soon.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
