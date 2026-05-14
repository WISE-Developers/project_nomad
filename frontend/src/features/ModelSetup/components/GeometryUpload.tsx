/**
 * GeometryUpload Component
 *
 * Upload GeoJSON or KML files to import geometry.
 */

import React, { useState, useCallback, useRef } from 'react';
import type { DrawnFeature } from '../../Map/types/geometry';

export interface GeometryUploadProps {
  /** Called when features are successfully parsed from file */
  onUpload: (features: DrawnFeature[]) => void;
}

const dropzoneStyle: React.CSSProperties = {
  border: '2px dashed #ccc',
  borderRadius: '8px',
  padding: '32px',
  textAlign: 'center',
  cursor: 'pointer',
  transition: 'border-color 0.2s, background-color 0.2s',
};

const dropzoneActiveStyle: React.CSSProperties = {
  ...dropzoneStyle,
  borderColor: '#ff6b35',
  backgroundColor: 'rgba(255, 107, 53, 0.1)',
};

const errorStyle: React.CSSProperties = {
  color: '#e74c3c',
  fontSize: '14px',
  marginTop: '8px',
};

const successStyle: React.CSSProperties = {
  color: '#2ecc71',
  fontSize: '14px',
  marginTop: '8px',
};

/**
 * Component for uploading geometry files
 */
export function GeometryUpload({ onUpload }: GeometryUploadProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setError('');
      setSuccess('');

      const extension = file.name.split('.').pop()?.toLowerCase();

      if (!['json', 'geojson', 'kml'].includes(extension || '')) {
        setError('Unsupported file format. Please use GeoJSON (.json, .geojson) or KML (.kml)');
        return;
      }

      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/v1/perimeters/import', { method: 'POST', body: form });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const msg =
            body?.error?.details?.fieldErrors?.[0]?.message ??
            body?.error?.message ??
            'Failed to validate file';
          setError(msg);
          return;
        }

        const fc = (await res.json()) as { features: DrawnFeature[] };
        const features = fc.features.map((f) => ({
          ...f,
          properties: {
            ...f.properties,
            inputMethod: 'upload',
            fileName: file.name,
          },
        }));

        setSuccess(`Successfully loaded ${features.length} feature(s) from ${file.name}`);
        onUpload(features);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload file');
      }
    },
    [onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragActive(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragActive(false);
  }, []);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile]
  );

  return (
    <div style={{ padding: '16px' }}>
      <div
        style={isDragActive ? dropzoneActiveStyle : dropzoneStyle}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.geojson,.kml"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <div style={{ fontSize: '24px', marginBottom: '8px', color: '#666' }}><i className="fa-solid fa-folder-open" /></div>
        <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#333' }}>
          {isDragActive ? 'Drop file here' : 'Click or drag file to upload'}
        </div>
        <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
          Supports GeoJSON (.json, .geojson) and KML (.kml)
        </div>
      </div>

      {error && <div style={errorStyle}>{error}</div>}
      {success && <div style={successStyle}>{success}</div>}
    </div>
  );
}
