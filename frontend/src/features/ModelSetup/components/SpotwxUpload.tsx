/**
 * SpotwxUpload Component
 *
 * Upload a SpotWX CSV export (basic or prometheus) and normalize it into
 * Nomad's raw weather shape before handing the parsed result to the parent.
 * The caller still owns FWI starting codes (supplied via StartingCodesInput
 * in WeatherStep).
 */

import React, { useCallback, useRef, useState } from 'react';
import type { ParsedWeatherCSV } from '../types';
import { parseSpotwxCsv } from '../../../openNomad/weather/index.js';
import { buildParsedWeatherCSV } from '../utils/weatherValidation.js';

export interface SpotwxUploadProps {
  onUpload: (file: File, parsed: ParsedWeatherCSV) => void;
  fileName?: string;
  parsed?: ParsedWeatherCSV;
  error?: string;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: '6px',
  border: '1px solid #2e86c1',
  background: '#2e86c1',
  color: 'white',
  cursor: 'pointer',
  fontSize: '14px',
  alignSelf: 'flex-start',
};

const fileInfoStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#333',
};

const errorStyle: React.CSSProperties = {
  color: '#c0392b',
  fontSize: '13px',
};

const noticeStyle: React.CSSProperties = {
  color: '#8a6d3b',
  backgroundColor: '#fcf8e3',
  border: '1px solid #faebcc',
  borderRadius: '4px',
  padding: '8px 10px',
  fontSize: '13px',
};

export function SpotwxUpload({ onUpload, fileName, parsed, error }: SpotwxUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setParseError(null);
      setNotice(null);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = (e.target?.result as string) ?? '';
          const { headers, rows, truncatedRowCount } = parseSpotwxCsv(content);
          const parsedData = buildParsedWeatherCSV(headers, rows);
          if (truncatedRowCount) {
            const plural = truncatedRowCount === 1 ? 'row' : 'rows';
            setNotice(
              `Dropped ${truncatedRowCount} ${plural} past the hourly→3-hourly transition. ` +
                'For longer hourly runs, export a prometheus-format CSV from SpotWX.',
            );
          }
          onUpload(file, parsedData);
        } catch (err) {
          setParseError(err instanceof Error ? err.message : 'Failed to parse SpotWX file');
        }
      };
      reader.onerror = () => setParseError('Failed to read file');
      reader.readAsText(file);
    },
    [onUpload],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = '';
    },
    [handleFile],
  );

  const displayError = parseError ?? error;
  const hasFile = Boolean(fileName);

  return (
    <div style={containerStyle}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        aria-label="Upload SpotWX CSV"
        onChange={handleInputChange}
        style={{ display: 'none' }}
      />
      <button
        type="button"
        style={buttonStyle}
        onClick={() => fileInputRef.current?.click()}
      >
        {hasFile ? 'Replace SpotWX file' : 'Upload SpotWX file'}
      </button>
      {hasFile && !displayError && (
        <div style={fileInfoStyle}>
          {fileName} — {parsed?.rowCount ?? 0} records
          {parsed?.dateRange
            ? ` (${parsed.dateRange.minDate} to ${parsed.dateRange.maxDate})`
            : ''}
        </div>
      )}
      {notice && !displayError && (
        <div style={noticeStyle} role="status">
          {notice}
        </div>
      )}
      {displayError && (
        <div style={errorStyle} role="alert">
          {displayError}
        </div>
      )}
    </div>
  );
}
