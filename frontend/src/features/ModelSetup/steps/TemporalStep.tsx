/**
 * TemporalStep Component
 *
 * Second wizard step for setting simulation start time and duration.
 */

import React, { useCallback, useMemo } from 'react';
import { useWizardData } from '../../Wizard';
import type { ModelSetupData } from '../types';

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  padding: '16px',
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 'bold',
  color: '#333',
};

const inputRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  alignItems: 'center',
};

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: '14px',
  border: '1px solid #ccc',
  borderRadius: '4px',
};

const rangeContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const rangeStyle: React.CSSProperties = {
  width: '100%',
  height: '8px',
  appearance: 'none',
  background: 'linear-gradient(to right, #ff6b35, #e74c3c)',
  borderRadius: '4px',
  cursor: 'pointer',
};

const presetButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: '12px',
  border: '1px solid #ccc',
  borderRadius: '4px',
  background: 'white',
  cursor: 'pointer',
};

const activePresetStyle: React.CSSProperties = {
  ...presetButtonStyle,
  backgroundColor: '#ff6b35',
  borderColor: '#ff6b35',
  color: 'white',
};

const infoBoxStyle: React.CSSProperties = {
  padding: '12px',
  backgroundColor: '#f5f5f5',
  borderRadius: '4px',
  fontSize: '14px',
};

const forecastBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 8px',
  fontSize: '12px',
  fontWeight: 'bold',
  borderRadius: '4px',
  marginLeft: '8px',
};

const DURATION_PRESETS = [6, 12, 24, 48, 72, 168];

/**
 * Format duration for display
 */
function formatDuration(hours: number): string {
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (remainingHours === 0) {
    return `${days}d`;
  }
  return `${days}d ${remainingHours}h`;
}

/**
 * Calculate end date/time from start and duration
 */
function calculateEndDateTime(startDate: string, startTime: string, durationHours: number): string {
  if (!startDate || !startTime) return '';

  try {
    const start = new Date(`${startDate}T${startTime}`);
    const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);

    return end.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * Check if a date is in the future
 */
function isFutureDate(dateStr: string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date > today;
}

/**
 * Temporal Step component
 */
export function TemporalStep() {
  const { data, setField } = useWizardData<ModelSetupData>();

  const temporal = data.temporal ?? {
    startDate: '',
    startTime: '12:00',
    durationHours: 24,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isForecast: false,
  };

  // Update start date
  const handleDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newDate = e.target.value;
      setField('temporal', {
        ...temporal,
        startDate: newDate,
        isForecast: isFutureDate(newDate),
      });
    },
    [setField, temporal]
  );

  // Update start time
  const handleTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setField('temporal', {
        ...temporal,
        startTime: e.target.value,
      });
    },
    [setField, temporal]
  );

  // Update duration
  const handleDurationChange = useCallback(
    (hours: number) => {
      setField('temporal', {
        ...temporal,
        durationHours: hours,
      });
    },
    [setField, temporal]
  );

  // Calculate end date/time
  const endDateTime = useMemo(
    () => calculateEndDateTime(temporal.startDate, temporal.startTime, temporal.durationHours),
    [temporal.startDate, temporal.startTime, temporal.durationHours]
  );

  return (
    <div style={containerStyle}>
      {/* Start Date/Time */}
      <div style={sectionStyle}>
        <label style={labelStyle}>
          Start Date & Time
          {temporal.isForecast && (
            <span style={{ ...forecastBadgeStyle, backgroundColor: '#3498db', color: 'white' }}>
              Forecast Mode
            </span>
          )}
          {temporal.startDate && !temporal.isForecast && (
            <span style={{ ...forecastBadgeStyle, backgroundColor: '#2ecc71', color: 'white' }}>
              Historical Mode
            </span>
          )}
        </label>
        <div style={inputRowStyle}>
          <input
            type="date"
            value={temporal.startDate}
            onChange={handleDateChange}
            style={{ ...inputStyle, width: '160px' }}
          />
          <input
            type="time"
            value={temporal.startTime}
            onChange={handleTimeChange}
            style={{ ...inputStyle, width: '120px' }}
          />
        </div>
        <div style={{ fontSize: '12px', color: '#666' }}>
          Timezone: {temporal.timezone}
        </div>
      </div>

      {/* Duration */}
      <div style={sectionStyle}>
        <label style={labelStyle}>
          Simulation Duration: {formatDuration(temporal.durationHours)}
        </label>

        {/* Preset buttons */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {DURATION_PRESETS.map((hours) => (
            <button
              key={hours}
              style={temporal.durationHours === hours ? activePresetStyle : presetButtonStyle}
              onClick={() => handleDurationChange(hours)}
            >
              {formatDuration(hours)}
            </button>
          ))}
        </div>

        {/* Slider */}
        <div style={rangeContainerStyle}>
          <input
            type="range"
            min={1}
            max={720}
            value={temporal.durationHours}
            onChange={(e) => handleDurationChange(parseInt(e.target.value, 10))}
            style={rangeStyle}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#888' }}>
            <span>1 hour</span>
            <span>30 days</span>
          </div>
        </div>
      </div>

      {/* End Time Display */}
      {endDateTime && (
        <div style={infoBoxStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#666' }}>Simulation End:</span>
            <span style={{ fontWeight: 'bold' }}>{endDateTime}</span>
          </div>
        </div>
      )}

      {/* Mode explanation */}
      <div style={{ ...infoBoxStyle, backgroundColor: temporal.isForecast ? '#ebf5fb' : '#eafaf1' }}>
        {temporal.isForecast ? (
          <>
            <strong>Forecast Mode:</strong> The simulation starts in the future. Weather data will be
            sourced from forecast models.
          </>
        ) : temporal.startDate ? (
          <>
            <strong>Historical Mode:</strong> The simulation starts in the past. Weather data will be
            sourced from historical records.
          </>
        ) : (
          <>
            Select a start date. If the date is in the past, historical weather data will be used. If
            it's in the future, forecast data will be used.
          </>
        )}
      </div>
    </div>
  );
}
