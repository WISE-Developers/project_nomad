/**
 * FWIInput Component
 *
 * Form for entering Fire Weather Index (FWI) values.
 */

import React, { useCallback } from 'react';
import type { FWIValues } from '../types';
import { getFireDangerRating, getFireDangerColor, SPRING_STARTUP_FWI } from '../types';

export interface FWIInputProps {
  /** Current FWI values */
  values: Partial<FWIValues>;
  /** Called when values change */
  onChange: (values: FWIValues) => void;
  /** Field-level errors */
  errors?: Record<string, string>;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: '16px',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 'bold',
  color: '#333',
  display: 'flex',
  justifyContent: 'space-between',
};

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: '14px',
  border: '1px solid #ccc',
  borderRadius: '4px',
  width: '100%',
  boxSizing: 'border-box',
};

const errorInputStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: '#e74c3c',
};

const errorTextStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#e74c3c',
};

const helpTextStyle: React.CSSProperties = {
  fontSize: '10px',
  color: '#888',
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '14px',
  backgroundColor: '#27ae60',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};

const ratingBoxStyle: React.CSSProperties = {
  padding: '12px',
  borderRadius: '4px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

interface FWIField {
  id: keyof FWIValues;
  label: string;
  fullName: string;
  min: number;
  max: number | null;
  step: number;
}

const fields: FWIField[] = [
  { id: 'ffmc', label: 'FFMC', fullName: 'Fine Fuel Moisture Code', min: 0, max: 101, step: 0.1 },
  { id: 'dmc', label: 'DMC', fullName: 'Duff Moisture Code', min: 0, max: null, step: 0.1 },
  { id: 'dc', label: 'DC', fullName: 'Drought Code', min: 0, max: null, step: 0.1 },
  { id: 'isi', label: 'ISI', fullName: 'Initial Spread Index', min: 0, max: null, step: 0.1 },
  { id: 'bui', label: 'BUI', fullName: 'Buildup Index', min: 0, max: null, step: 0.1 },
  { id: 'fwi', label: 'FWI', fullName: 'Fire Weather Index', min: 0, max: null, step: 0.1 },
];

/**
 * FWI Input component
 */
export function FWIInput({ values, onChange, errors = {} }: FWIInputProps) {
  // Handle field change
  const handleFieldChange = useCallback(
    (field: keyof FWIValues, value: string) => {
      const numValue = parseFloat(value);
      onChange({
        ffmc: values.ffmc ?? 0,
        dmc: values.dmc ?? 0,
        dc: values.dc ?? 0,
        isi: values.isi ?? 0,
        bui: values.bui ?? 0,
        fwi: values.fwi ?? 0,
        [field]: isNaN(numValue) ? 0 : numValue,
      });
    },
    [values, onChange]
  );

  // Apply spring startup values
  const handleSpringStartup = useCallback(() => {
    onChange(SPRING_STARTUP_FWI);
  }, [onChange]);

  // Calculate fire danger rating
  const fwiValue = values.fwi ?? 0;
  const rating = getFireDangerRating(fwiValue);
  const ratingColor = getFireDangerColor(rating);

  return (
    <div style={containerStyle}>
      {/* Quick fill button */}
      <div>
        <button type="button" style={buttonStyle} onClick={handleSpringStartup}>
          🌱 Use Spring Startup Values
        </button>
        <span style={{ marginLeft: '12px', fontSize: '12px', color: '#666' }}>
          (FFMC: 85, DMC: 6, DC: 15)
        </span>
      </div>

      {/* FWI input grid */}
      <div style={gridStyle}>
        {fields.map((field) => {
          const value = values[field.id];
          const hasError = !!errors[field.id];

          return (
            <div key={field.id} style={fieldStyle}>
              <label style={labelStyle}>
                <span title={field.fullName}>{field.label}</span>
                {field.max !== null && (
                  <span style={helpTextStyle}>
                    {field.min}-{field.max}
                  </span>
                )}
              </label>
              <input
                type="number"
                min={field.min}
                max={field.max ?? undefined}
                step={field.step}
                value={value ?? ''}
                onChange={(e) => handleFieldChange(field.id, e.target.value)}
                style={hasError ? errorInputStyle : inputStyle}
                placeholder={field.fullName}
              />
              {hasError && <span style={errorTextStyle}>{errors[field.id]}</span>}
            </div>
          );
        })}
      </div>

      {/* Fire Danger Rating Display */}
      <div style={{ ...ratingBoxStyle, backgroundColor: `${ratingColor}20`, border: `2px solid ${ratingColor}` }}>
        <span style={{ fontSize: '14px', color: '#333' }}>
          <strong>Fire Danger Rating:</strong>
        </span>
        <span
          style={{
            fontSize: '16px',
            fontWeight: 'bold',
            color: ratingColor,
            padding: '4px 12px',
            backgroundColor: 'white',
            borderRadius: '4px',
          }}
        >
          {rating}
        </span>
      </div>

      {/* FWI explanation */}
      <div style={{ fontSize: '12px', color: '#555', lineHeight: 1.5 }}>
        <strong style={{ color: '#333' }}>About FWI System:</strong> The Canadian Fire Weather Index (FWI) System rates fire
        danger using six components. FFMC, DMC, and DC track moisture content in fine fuels, duff,
        and deep organic layers. ISI and BUI rate fire spread and fuel consumption potential. FWI is
        the overall fire intensity indicator.
      </div>
    </div>
  );
}
