/**
 * CoordinateInput Component
 *
 * Manual latitude/longitude input for point geometry.
 */

import React, { useState, useCallback } from 'react';
import type { DrawnFeature } from '../../Map/types/geometry';
import { CANADA_BOUNDS } from '../types';

export interface CoordinateInputProps {
  /** Called when coordinates are submitted */
  onSubmit: (feature: DrawnFeature) => void;
  /** Current latitude value */
  initialLat?: number;
  /** Current longitude value */
  initialLng?: number;
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: '14px',
  border: '1px solid #ccc',
  borderRadius: '4px',
  width: '120px',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  fontSize: '12px',
  color: '#666',
};

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '14px',
  backgroundColor: '#ff6b35',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  color: '#e74c3c',
  fontSize: '12px',
  marginTop: '4px',
};

/**
 * Component for entering lat/lng coordinates manually
 */
export function CoordinateInput({ onSubmit, initialLat, initialLng }: CoordinateInputProps) {
  const [lat, setLat] = useState<string>(initialLat?.toString() ?? '');
  const [lng, setLng] = useState<string>(initialLng?.toString() ?? '');
  const [error, setError] = useState<string>('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError('');

      const latNum = parseFloat(lat);
      const lngNum = parseFloat(lng);

      // Validate numbers
      if (isNaN(latNum) || isNaN(lngNum)) {
        setError('Please enter valid numbers for latitude and longitude');
        return;
      }

      // Validate latitude range
      if (latNum < -90 || latNum > 90) {
        setError('Latitude must be between -90 and 90');
        return;
      }

      // Validate longitude range
      if (lngNum < -180 || lngNum > 180) {
        setError('Longitude must be between -180 and 180');
        return;
      }

      // Validate within Canada bounds
      const [minLng, minLat, maxLng, maxLat] = CANADA_BOUNDS;
      if (lngNum < minLng || lngNum > maxLng || latNum < minLat || latNum > maxLat) {
        setError(`Coordinates must be within Canada (${minLat}°-${maxLat}°N, ${minLng}°-${maxLng}°W)`);
        return;
      }

      // Create point feature
      const feature: DrawnFeature = {
        type: 'Feature',
        id: `coord-${Date.now()}`,
        properties: {
          inputMethod: 'coordinates',
        },
        geometry: {
          type: 'Point',
          coordinates: [lngNum, latNum],
        },
      };

      onSubmit(feature);
    },
    [lat, lng, onSubmit]
  );

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}
    >
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
        <label style={labelStyle}>
          Latitude (°N)
          <input
            type="number"
            step="any"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="54.5"
            style={inputStyle}
          />
        </label>

        <label style={labelStyle}>
          Longitude (°W)
          <input
            type="number"
            step="any"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="-115.5"
            style={inputStyle}
          />
        </label>

        <button type="submit" style={buttonStyle}>
          Add Point
        </button>
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={{ fontSize: '12px', color: '#888' }}>
        Enter coordinates in decimal degrees. Longitude should be negative for western Canada.
      </div>
    </form>
  );
}
