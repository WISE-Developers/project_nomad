/**
 * WeatherUpload Component
 *
 * Upload weather data CSV files (stub for MVP).
 */

import React from 'react';

export interface WeatherUploadProps {
  /** Called when a file is uploaded */
  onUpload: (fileName: string) => void;
}

const containerStyle: React.CSSProperties = {
  padding: '24px',
  border: '2px dashed #ccc',
  borderRadius: '8px',
  textAlign: 'center',
  backgroundColor: '#f9f9f9',
};

const iconStyle: React.CSSProperties = {
  fontSize: '48px',
  marginBottom: '16px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 'bold',
  color: '#333',
  marginBottom: '8px',
};

const descStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#666',
  marginBottom: '16px',
};

const comingSoonStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 16px',
  backgroundColor: '#95a5a6',
  color: 'white',
  borderRadius: '4px',
  fontSize: '14px',
  fontWeight: 'bold',
};

/**
 * Weather Upload component (stub)
 */
export function WeatherUpload(_props: WeatherUploadProps) {
  return (
    <div style={containerStyle}>
      <div style={iconStyle}><i className="fa-solid fa-chart-bar" /></div>
      <div style={titleStyle}>Weather Data Upload</div>
      <div style={descStyle}>
        Upload hourly weather data in CSV format with temperature, humidity, wind speed, and
        precipitation values.
      </div>
      <div style={comingSoonStyle}>Coming Soon</div>
      <div style={{ marginTop: '16px', fontSize: '12px', color: '#888' }}>
        For now, please use manual FWI input or wait for SpotWX integration.
      </div>
    </div>
  );
}
