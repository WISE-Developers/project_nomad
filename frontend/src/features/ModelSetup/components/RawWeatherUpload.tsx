/**
 * RawWeatherUpload Component
 *
 * Upload raw weather CSV files that don't have FWI indices.
 * User provides starting codes (FFMC, DMC, DC) and the backend calculates FWI.
 *
 * Expected minimum format:
 * Date,PREC,TEMP,RH,WS,WD
 *
 * Or with optional Scenario column:
 * Scenario,Date,PREC,TEMP,RH,WS,WD
 */

import React, { useCallback, useRef, useState } from 'react';
import type { ParsedWeatherCSV, FWIStartingCodes } from '../types';
import { StartingCodesInput } from './StartingCodesInput';

export interface RawWeatherUploadProps {
  /** Called when a valid file is uploaded */
  onFileUpload: (file: File, parsed: ParsedWeatherCSV) => void;
  /** Called when starting codes change */
  onStartingCodesChange: (codes: FWIStartingCodes) => void;
  /** Currently uploaded file name */
  fileName?: string;
  /** Parsed CSV data for preview */
  parsed?: ParsedWeatherCSV;
  /** Current starting codes */
  startingCodes?: Partial<FWIStartingCodes>;
  /** Optional error message */
  error?: string;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 'bold',
  color: '#333',
  borderBottom: '1px solid #ddd',
  paddingBottom: '8px',
};

const dropZoneStyle: React.CSSProperties = {
  padding: '32px',
  border: '2px dashed #ccc',
  borderRadius: '8px',
  textAlign: 'center',
  backgroundColor: '#f9f9f9',
  cursor: 'pointer',
  transition: 'all 0.2s',
};

const dropZoneActiveStyle: React.CSSProperties = {
  ...dropZoneStyle,
  borderColor: '#ff6b35',
  backgroundColor: '#fff5f0',
};

const dropZoneWithFileStyle: React.CSSProperties = {
  ...dropZoneStyle,
  borderColor: '#27ae60',
  backgroundColor: '#eafaf1',
};

const iconStyle: React.CSSProperties = {
  fontSize: '48px',
  marginBottom: '12px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 'bold',
  color: '#333',
  marginBottom: '8px',
};

const subtitleStyle: React.CSSProperties = {
  fontSize: '14px',
  color: '#666',
};

const previewStyle: React.CSSProperties = {
  backgroundColor: '#f5f5f5',
  borderRadius: '4px',
  padding: '12px',
  overflow: 'auto',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '12px',
};

const thStyle: React.CSSProperties = {
  backgroundColor: '#333',
  color: 'white',
  padding: '8px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid #ddd',
  whiteSpace: 'nowrap',
};

const errorStyle: React.CSSProperties = {
  backgroundColor: '#fce4e4',
  border: '1px solid #e74c3c',
  borderRadius: '4px',
  padding: '12px',
  color: '#c0392b',
  fontSize: '14px',
};

const successStyle: React.CSSProperties = {
  backgroundColor: '#eafaf1',
  border: '1px solid #27ae60',
  borderRadius: '4px',
  padding: '12px',
  color: '#1e8449',
  fontSize: '14px',
};

const infoStyle: React.CSSProperties = {
  backgroundColor: '#ebf5fb',
  border: '1px solid #3498db',
  borderRadius: '4px',
  padding: '12px',
  color: '#1a5276',
  fontSize: '14px',
};

// Required columns for raw weather file
const REQUIRED_COLUMNS = ['Date', 'PREC', 'TEMP', 'RH', 'WS', 'WD'];
const FWI_COLUMNS = ['FFMC', 'DMC', 'DC', 'ISI', 'BUI', 'FWI'];

/**
 * Parse a CSV file and extract header and data
 */
function parseCSV(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.trim().split('\n');
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split(',').map((cell) => cell.trim()));

  return { headers, rows };
}

/**
 * Validate that all required columns are present
 */
function validateColumns(headers: string[]): { valid: boolean; missing: string[] } {
  const headerSet = new Set(headers.map((h) => h.toUpperCase()));
  const missing = REQUIRED_COLUMNS.filter((col) => !headerSet.has(col.toUpperCase()));
  return { valid: missing.length === 0, missing };
}

/**
 * Raw Weather Upload component
 */
export function RawWeatherUpload({
  onFileUpload,
  onStartingCodesChange,
  fileName,
  parsed,
  startingCodes,
  error,
}: RawWeatherUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Handle file selection
  const handleFile = useCallback(
    (file: File) => {
      setParseError(null);

      if (!file.name.endsWith('.csv')) {
        setParseError('Please upload a CSV file');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const { headers, rows } = parseCSV(content);

        if (headers.length === 0) {
          setParseError('CSV file appears to be empty');
          return;
        }

        // Check for required columns
        const validation = validateColumns(headers);
        if (!validation.valid) {
          setParseError(`Missing required columns: ${validation.missing.join(', ')}`);
          return;
        }

        // Check if file has FWI columns (would be wrong file type)
        const headerSet = new Set(headers.map((h) => h.toUpperCase()));
        const hasFWI = FWI_COLUMNS.every((col) => headerSet.has(col.toUpperCase()));
        const hasScenario = headerSet.has('SCENARIO');

        const parsedData: ParsedWeatherCSV = {
          headers,
          rowCount: rows.length,
          previewRows: rows.slice(0, 5),
          hasScenarioColumn: hasScenario,
          hasFWIColumns: hasFWI,
        };

        onFileUpload(file, parsedData);
      };

      reader.onerror = () => {
        setParseError('Failed to read file');
      };

      reader.readAsText(file);
    },
    [onFileUpload]
  );

  // Handle click to open file picker
  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle file input change
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const displayError = error || parseError;
  const hasFile = !!fileName && !!parsed;

  // Determine drop zone style
  let currentDropZoneStyle = dropZoneStyle;
  if (isDragging) {
    currentDropZoneStyle = dropZoneActiveStyle;
  } else if (hasFile && !displayError) {
    currentDropZoneStyle = dropZoneWithFileStyle;
  }

  return (
    <div style={containerStyle}>
      {/* Section 1: File Upload */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>Step 1: Upload Raw Weather Data</div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleInputChange}
          style={{ display: 'none' }}
        />

        {/* Drop zone */}
        <div
          style={currentDropZoneStyle}
          onClick={handleClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div style={iconStyle}>{hasFile ? (displayError ? '!' : '!') : '!'}</div>
          {hasFile ? (
            <>
              <div style={titleStyle}>{fileName}</div>
              <div style={subtitleStyle}>
                {parsed?.rowCount} weather records found. Click or drag to replace.
              </div>
            </>
          ) : (
            <>
              <div style={titleStyle}>Upload Raw Weather CSV</div>
              <div style={subtitleStyle}>
                Drag and drop a CSV file or click to browse
              </div>
            </>
          )}
        </div>

        {/* Error display */}
        {displayError && (
          <div style={errorStyle}>
            <strong>Error:</strong> {displayError}
          </div>
        )}

        {/* Warning if file has FWI columns */}
        {parsed && parsed.hasFWIColumns && (
          <div style={infoStyle}>
            <strong>Note:</strong> This file already contains FWI columns. You may want to use the
            "FireSTARR CSV" tab instead for pre-calculated weather data.
          </div>
        )}

        {/* Success message */}
        {hasFile && !displayError && !parsed?.hasFWIColumns && (
          <div style={successStyle}>
            <strong>Valid raw weather file</strong> - {parsed?.rowCount} hourly records. FWI
            indices will be calculated using the starting codes below.
          </div>
        )}

        {/* Preview table */}
        {parsed && parsed.previewRows.length > 0 && !displayError && (
          <div style={previewStyle}>
            <div style={{ marginBottom: '8px', fontSize: '12px', color: '#666' }}>
              Preview (first {parsed.previewRows.length} rows):
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {parsed.headers.map((header, i) => (
                      <th key={i} style={thStyle}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.previewRows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} style={tdStyle}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Expected format info */}
        <div
          style={{
            padding: '12px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            fontSize: '12px',
            color: '#555',
          }}
        >
          <strong>Expected CSV Format:</strong>
          <code
            style={{
              display: 'block',
              marginTop: '8px',
              padding: '8px',
              backgroundColor: '#fff',
              borderRadius: '4px',
              fontFamily: 'monospace',
              fontSize: '11px',
            }}
          >
            Date,PREC,TEMP,RH,WS,WD
          </code>
          <div style={{ marginTop: '8px' }}>
            Raw weather data without FWI columns. The system will calculate FFMC, DMC, DC, ISI,
            BUI, and FWI using the Canadian Fire Weather Index System (CFFDRS).
          </div>
        </div>
      </div>

      {/* Section 2: Starting Codes */}
      <div style={sectionStyle}>
        <div style={sectionHeaderStyle}>Step 2: Enter Starting Codes</div>
        <StartingCodesInput
          values={startingCodes ?? {}}
          onChange={onStartingCodesChange}
        />
      </div>
    </div>
  );
}
