/**
 * ModelSummary Component
 *
 * Displays a summary of all model setup data for review.
 */

import React from 'react';
import type { ModelSetupData } from '../types';
import { getFireDangerRating, getFireDangerColor } from '../types';

export interface ModelSummaryProps {
  /** Complete model setup data */
  data: ModelSetupData;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const cardStyle: React.CSSProperties = {
  padding: '16px',
  backgroundColor: '#f8f9fa',
  borderRadius: '8px',
  border: '1px solid #e9ecef',
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 'bold',
  color: '#333',
  marginBottom: '12px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '4px 0',
  fontSize: '13px',
};

const labelStyle: React.CSSProperties = {
  color: '#555',
};

const valueStyle: React.CSSProperties = {
  fontWeight: 500,
  color: '#333',
};

/**
 * Format geometry type for display
 */
function formatGeometryType(type: string): string {
  switch (type) {
    case 'Point':
      return 'Point (Ignition)';
    case 'LineString':
      return 'Line (Fire Front)';
    case 'Polygon':
      return 'Polygon (Perimeter)';
    default:
      return type || 'Not set';
  }
}

/**
 * Format duration for display
 */
function formatDuration(hours: number): string {
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (remainingHours === 0) {
    return `${days} day${days !== 1 ? 's' : ''}`;
  }
  return `${days} day${days !== 1 ? 's' : ''} ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string, timeStr: string): string {
  if (!dateStr) return 'Not set';
  try {
    const date = new Date(`${dateStr}T${timeStr || '00:00'}`);
    return date.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Model Summary component
 */
export function ModelSummary({ data }: ModelSummaryProps) {
  const startingCodes = data.weather?.startingCodes;
  // Note: Fire danger rating functions kept for future use when we calculate FWI
  void getFireDangerRating;
  void getFireDangerColor;

  return (
    <div style={containerStyle}>
      {/* Spatial Summary */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <i className="fa-solid fa-location-dot" />
          <span>Location</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Input Method:</span>
          <span style={valueStyle}>
            {data.geometry?.inputMethod === 'draw'
              ? 'Draw on Map'
              : data.geometry?.inputMethod === 'coordinates'
                ? 'Manual Coordinates'
                : data.geometry?.inputMethod === 'upload'
                  ? 'File Upload'
                  : 'Not set'}
          </span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Geometry Type:</span>
          <span style={valueStyle}>
            {data.geometry?.features?.length
              ? formatGeometryType(data.geometry.features[0]?.geometry?.type)
              : 'No geometry'}
          </span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Features:</span>
          <span style={valueStyle}>{data.geometry?.features?.length ?? 0} feature(s)</span>
        </div>
        {data.geometry?.bounds && (
          <div style={rowStyle}>
            <span style={labelStyle}>Bounds:</span>
            <span style={valueStyle}>
              {data.geometry.bounds[1].toFixed(4)}°N, {Math.abs(data.geometry.bounds[0]).toFixed(4)}
              °W
            </span>
          </div>
        )}
      </div>

      {/* Temporal Summary */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <i className="fa-solid fa-clock" />
          <span>Time Range</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Start:</span>
          <span style={valueStyle}>
            {formatDate(data.temporal?.startDate ?? '', data.temporal?.startTime ?? '')}
          </span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Duration:</span>
          <span style={valueStyle}>{formatDuration(data.temporal?.durationHours ?? 0)}</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Mode:</span>
          <span
            style={{
              ...valueStyle,
              color: data.temporal?.isForecast ? '#3498db' : '#27ae60',
            }}
          >
            {data.temporal?.isForecast ? 'Forecast' : 'Historical'}
          </span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Timezone:</span>
          <span style={valueStyle}>{data.temporal?.timezone ?? 'Not set'}</span>
        </div>
      </div>

      {/* Model Summary */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <i className="fa-solid fa-fire" />
          <span>Model Configuration</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Engine:</span>
          <span style={valueStyle}>
            {data.model?.engine === 'firestarr' ? 'FireSTARR' : data.model?.engine?.toUpperCase() ?? 'Not set'}
          </span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Run Type:</span>
          <span style={valueStyle}>
            {data.model?.runType === 'deterministic'
              ? 'Deterministic (Single Run)'
              : data.model?.runType === 'probabilistic'
                ? 'Probabilistic (Multiple Runs)'
                : 'Not set'}
          </span>
        </div>
      </div>

      {/* Weather Summary */}
      <div style={cardStyle}>
        <div style={cardTitleStyle}>
          <i className="fa-solid fa-cloud-sun" />
          <span>Weather Data</span>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Source:</span>
          <span style={valueStyle}>
            {data.weather?.source === 'firestarr_csv'
              ? 'FireSTARR CSV'
              : data.weather?.source === 'raw_weather'
                ? 'Raw Weather + Codes'
                : data.weather?.source === 'spotwx'
                  ? 'SpotWX Forecast'
                  : 'Not set'}
          </span>
        </div>
        {/* FireSTARR CSV source */}
        {data.weather?.source === 'firestarr_csv' && data.weather.firestarrCsvFileName && (
          <div style={rowStyle}>
            <span style={labelStyle}>File:</span>
            <span style={valueStyle}>{data.weather.firestarrCsvFileName}</span>
          </div>
        )}
        {data.weather?.source === 'firestarr_csv' && data.weather.firestarrCsvParsed && (
          <div style={rowStyle}>
            <span style={labelStyle}>Records:</span>
            <span style={valueStyle}>{data.weather.firestarrCsvParsed.rowCount} hourly records</span>
          </div>
        )}

        {/* Raw Weather source */}
        {data.weather?.source === 'raw_weather' && data.weather.rawWeatherFileName && (
          <div style={rowStyle}>
            <span style={labelStyle}>File:</span>
            <span style={valueStyle}>{data.weather.rawWeatherFileName}</span>
          </div>
        )}
        {data.weather?.source === 'raw_weather' && data.weather.rawWeatherParsed && (
          <div style={rowStyle}>
            <span style={labelStyle}>Records:</span>
            <span style={valueStyle}>{data.weather.rawWeatherParsed.rowCount} hourly records</span>
          </div>
        )}
        {data.weather?.source === 'raw_weather' && startingCodes && (
          <div style={rowStyle}>
            <span style={labelStyle}>Starting Codes:</span>
            <span style={valueStyle}>
              FFMC: {startingCodes.ffmc}, DMC: {startingCodes.dmc}, DC: {startingCodes.dc}
            </span>
          </div>
        )}

        {/* SpotWX source */}
        {data.weather?.source === 'spotwx' && (
          <div style={rowStyle}>
            <span style={labelStyle}>Status:</span>
            <span style={valueStyle}>Will fetch forecast data automatically</span>
          </div>
        )}
      </div>
    </div>
  );
}
