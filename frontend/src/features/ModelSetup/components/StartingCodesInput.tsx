/**
 * StartingCodesInput Component
 *
 * Form for entering FWI starting codes (FFMC, DMC, DC) for progressive CFFDRS calculation.
 * Simplified version of FWIInput with only the three moisture codes needed to initialize
 * the Canadian Fire Weather Index calculation.
 */

import React, { useCallback } from 'react';
import type { FWIStartingCodes } from '../types';
import { SPRING_STARTUP_CODES } from '../types';

export interface StartingCodesInputProps {
  /** Current starting code values */
  values: Partial<FWIStartingCodes>;
  /** Called when values change */
  onChange: (values: FWIStartingCodes) => void;
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
  gridTemplateColumns: 'repeat(3, 1fr)',
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

interface StartingCodeField {
  id: keyof FWIStartingCodes;
  label: string;
  fullName: string;
  min: number;
  max: number | null;
  step: number;
}

const fields: StartingCodeField[] = [
  { id: 'ffmc', label: 'FFMC', fullName: 'Fine Fuel Moisture Code', min: 0, max: 101, step: 0.1 },
  { id: 'dmc', label: 'DMC', fullName: 'Duff Moisture Code', min: 0, max: null, step: 0.1 },
  { id: 'dc', label: 'DC', fullName: 'Drought Code', min: 0, max: null, step: 0.1 },
];

/**
 * Starting Codes Input component
 */
export function StartingCodesInput({ values, onChange, errors = {} }: StartingCodesInputProps) {
  // Handle field change
  const handleFieldChange = useCallback(
    (field: keyof FWIStartingCodes, value: string) => {
      const numValue = parseFloat(value);
      onChange({
        ffmc: values.ffmc ?? 0,
        dmc: values.dmc ?? 0,
        dc: values.dc ?? 0,
        [field]: isNaN(numValue) ? 0 : numValue,
      });
    },
    [values, onChange]
  );

  // Apply spring startup values
  const handleSpringStartup = useCallback(() => {
    onChange(SPRING_STARTUP_CODES);
  }, [onChange]);

  return (
    <div style={containerStyle}>
      {/* Header with explanation */}
      <div style={{ fontSize: '14px', color: '#333', marginBottom: '8px' }}>
        <strong>FWI Starting Codes</strong>
        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
          These values initialize the progressive CFFDRS calculation. The system will calculate
          hourly FWI values from your weather data using these as starting points.
        </div>
      </div>

      {/* Quick fill button */}
      <div>
        <button type="button" style={buttonStyle} onClick={handleSpringStartup}>
          Use Spring Startup Values
        </button>
        <span style={{ marginLeft: '12px', fontSize: '12px', color: '#666' }}>
          (FFMC: 85, DMC: 6, DC: 15)
        </span>
      </div>

      {/* Starting codes input grid */}
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

      {/* Info box */}
      <div
        style={{
          padding: '12px',
          backgroundColor: '#ebf5fb',
          borderRadius: '4px',
          fontSize: '12px',
          color: '#555',
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: '#333' }}>About Starting Codes:</strong>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
          <li><strong>FFMC</strong> - Fine Fuel Moisture Code: Moisture in fine dead surface fuels (0-101)</li>
          <li><strong>DMC</strong> - Duff Moisture Code: Moisture in loosely compacted organic layers (0+)</li>
          <li><strong>DC</strong> - Drought Code: Moisture in deep compact organic layers (0+)</li>
        </ul>
      </div>
    </div>
  );
}
