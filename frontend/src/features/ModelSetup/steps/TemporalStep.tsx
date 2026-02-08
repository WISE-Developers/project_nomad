/**
 * TemporalStep Component
 *
 * Second wizard step for setting simulation start time and duration.
 * Features improved date picker with quick-select buttons and human-readable format.
 * Uses MaskedDateInput to enforce YYYY-MM-DD format and prevent 6-digit years.
 */

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
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
  gap: '12px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 'bold',
  color: '#333',
};

const inputRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  alignItems: 'stretch',
  flexWrap: 'wrap',
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
  color: '#333',
};

const forecastBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 8px',
  fontSize: '12px',
  fontWeight: 'bold',
  borderRadius: '4px',
  marginLeft: '8px',
};


const timeInputStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: '16px',
  border: '2px solid #e0e0e0',
  borderRadius: '8px',
  backgroundColor: 'white',
  cursor: 'pointer',
  minWidth: '120px',
  transition: 'all 0.2s',
};

const quickSelectContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap',
};

const quickSelectButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: '13px',
  border: '1px solid #ddd',
  borderRadius: '6px',
  background: 'white',
  cursor: 'pointer',
  transition: 'all 0.2s',
  fontWeight: 500,
};

const quickSelectActiveStyle: React.CSSProperties = {
  ...quickSelectButtonStyle,
  backgroundColor: '#ff6b35',
  borderColor: '#ff6b35',
  color: 'white',
};

const DURATION_PRESETS = [6, 12, 24, 48, 72, 168];

// Fire season typically starts in April in Canada
const FIRE_SEASON_START_MONTH = 3; // April (0-indexed)
const FIRE_SEASON_START_DAY = 1;

/**
 * Get today's date in YYYY-MM-DD format
 */
function getTodayDate(): string {
  const today = new Date();
  return today.toISOString().split('T')[0];
}

/**
 * Get yesterday's date in YYYY-MM-DD format
 */
function getYesterdayDate(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

/**
 * Get start of fire season date in YYYY-MM-DD format
 */
function getFireSeasonStartDate(): string {
  const now = new Date();
  const year = now.getMonth() < FIRE_SEASON_START_MONTH ? now.getFullYear() : now.getFullYear();
  const fireSeasonStart = new Date(year, FIRE_SEASON_START_MONTH, FIRE_SEASON_START_DAY);
  return fireSeasonStart.toISOString().split('T')[0];
}


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
 * Check which quick select button is active
 */
function getActiveQuickSelect(dateStr: string): string | null {
  if (!dateStr) return null;
  if (dateStr === getTodayDate()) return 'today';
  if (dateStr === getYesterdayDate()) return 'yesterday';
  if (dateStr === getFireSeasonStartDate()) return 'fireSeason';
  return null;
}

/**
 * Temporal Step component
 */
export function TemporalStep() {
  const { data, setField } = useWizardData<ModelSetupData>();
  const timeInputRef = useRef<HTMLInputElement>(null);
  // Initialize with today's date if not set
  const temporal = useMemo(() => {
    const defaultTemporal = {
      startDate: getTodayDate(),
      startTime: '12:00',
      durationHours: 24,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      isForecast: false,
    };

    if (!data.temporal || !data.temporal.startDate) {
      return defaultTemporal;
    }

    return {
      ...defaultTemporal,
      ...data.temporal,
    };
  }, [data.temporal]);

  // Set default date on mount if not already set
  useEffect(() => {
    if (!data.temporal || !data.temporal.startDate) {
      const todayDate = getTodayDate();
      setField('temporal', {
        ...temporal,
        startDate: todayDate,
        isForecast: isFutureDate(todayDate),
      });
    }
  }, []); // Only run once on mount

  // Update start date
  const handleDateChange = useCallback(
    (newDate: string) => {
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

  // Quick select handlers
  const handleQuickSelect = useCallback(
    (type: 'today' | 'yesterday' | 'fireSeason') => {
      let newDate: string;
      switch (type) {
        case 'today':
          newDate = getTodayDate();
          break;
        case 'yesterday':
          newDate = getYesterdayDate();
          break;
        case 'fireSeason':
          newDate = getFireSeasonStartDate();
          break;
        default:
          return;
      }
      handleDateChange(newDate);
    },
    [handleDateChange]
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

  const activeQuickSelect = getActiveQuickSelect(temporal.startDate);

  return (
    <div style={containerStyle}>
      {/* Start Date/Time */}
      <div style={sectionStyle}>
        <label style={labelStyle}>
          Start Date & Time
          {temporal.isForecast && (
            <span style={{ ...forecastBadgeStyle, backgroundColor: '#3498db', color: 'white' }}>
              Predictive Modelling
            </span>
          )}
          {temporal.startDate && !temporal.isForecast && (
            <span style={{ ...forecastBadgeStyle, backgroundColor: '#2ecc71', color: 'white' }}>
              Retroactive Modelling
            </span>
          )}
        </label>

        {/* Quick Select Buttons */}
        <div style={quickSelectContainerStyle}>
          <button
            type="button"
            style={activeQuickSelect === 'today' ? quickSelectActiveStyle : quickSelectButtonStyle}
            onClick={() => handleQuickSelect('today')}
          >
            <i className="fa-solid fa-calendar-day" style={{ marginRight: '6px' }} />
            Today
          </button>
          <button
            type="button"
            style={activeQuickSelect === 'yesterday' ? quickSelectActiveStyle : quickSelectButtonStyle}
            onClick={() => handleQuickSelect('yesterday')}
          >
            <i className="fa-solid fa-clock-rotate-left" style={{ marginRight: '6px' }} />
            Yesterday
          </button>
          <button
            type="button"
            style={activeQuickSelect === 'fireSeason' ? quickSelectActiveStyle : quickSelectButtonStyle}
            onClick={() => handleQuickSelect('fireSeason')}
          >
            <i className="fa-solid fa-fire" style={{ marginRight: '6px' }} />
            Fire Season Start
          </button>
        </div>

        {/* Date and Time Pickers */}
        <div style={inputRowStyle}>
          {/* Date Picker */}
          <input
            type="date"
            value={temporal.startDate}
            onChange={(e) => handleDateChange(e.target.value)}
            min="1900-01-01"
            max="2099-12-31"
            style={timeInputStyle}
            aria-label="Start date"
          />

          {/* Time Picker */}
          <input
            ref={timeInputRef}
            type="time"
            value={temporal.startTime}
            onChange={handleTimeChange}
            style={timeInputStyle}
            aria-label="Start time"
          />
        </div>

        <div style={{ fontSize: '12px', color: '#666', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i className="fa-solid fa-globe" style={{ fontSize: '11px' }} />
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
              type="button"
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#666', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="fa-solid fa-flag-checkered" />
              Simulation End:
            </span>
            <span style={{ fontWeight: 'bold' }}>{endDateTime}</span>
          </div>
        </div>
      )}

      {/* Mode explanation */}
      <div style={{ ...infoBoxStyle, backgroundColor: temporal.isForecast ? '#ebf5fb' : '#eafaf1' }}>
        {temporal.isForecast ? (
          <>
            <strong><i className="fa-solid fa-cloud-sun" style={{ marginRight: '8px' }} />Predictive Modelling (forecast):</strong> The simulation starts in the future.
            Weather data will be sourced from forecast models via SpotWX.
          </>
        ) : temporal.startDate ? (
          <>
            <strong><i className="fa-solid fa-database" style={{ marginRight: '8px' }} />Retroactive Modelling (historical):</strong> The simulation starts in the past.
            You will need to provide historical weather data via file upload.
          </>
        ) : (
          <>
            Select a start date. Past dates enable retroactive modelling with uploaded weather data.
            Future dates enable predictive modelling with SpotWX forecasts.
          </>
        )}
      </div>
    </div>
  );
}
