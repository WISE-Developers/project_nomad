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
 * Parse GeoJSON file content
 */
function parseGeoJSON(content: string): DrawnFeature[] {
  const json = JSON.parse(content);

  // Handle FeatureCollection
  if (json.type === 'FeatureCollection' && Array.isArray(json.features)) {
    return json.features.filter((f: GeoJSON.Feature) => {
      const type = f.geometry?.type;
      return type === 'Point' || type === 'LineString' || type === 'Polygon';
    });
  }

  // Handle single Feature
  if (json.type === 'Feature' && json.geometry) {
    const type = json.geometry.type;
    if (type === 'Point' || type === 'LineString' || type === 'Polygon') {
      return [json];
    }
  }

  // Handle raw geometry
  if (json.type === 'Point' || json.type === 'LineString' || json.type === 'Polygon') {
    return [
      {
        type: 'Feature',
        id: `upload-${Date.now()}`,
        properties: {},
        geometry: json,
      },
    ];
  }

  throw new Error('Invalid GeoJSON format. Expected Feature, FeatureCollection, or geometry object.');
}

/**
 * Basic KML parser (simplified - handles Point, LineString, Polygon)
 */
function parseKML(content: string): DrawnFeature[] {
  const features: DrawnFeature[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');

  // Helper to parse coordinate string
  const parseCoords = (coordStr: string): number[][] => {
    return coordStr
      .trim()
      .split(/\s+/)
      .map((coord) => {
        const parts = coord.split(',').map(Number);
        return [parts[0], parts[1]]; // [lng, lat]
      })
      .filter((c) => !isNaN(c[0]) && !isNaN(c[1]));
  };

  // Extract Points
  const points = doc.getElementsByTagName('Point');
  for (let i = 0; i < points.length; i++) {
    const coordsEl = points[i].getElementsByTagName('coordinates')[0];
    if (coordsEl) {
      const coords = parseCoords(coordsEl.textContent || '');
      if (coords.length > 0) {
        features.push({
          type: 'Feature',
          id: `kml-point-${i}`,
          properties: { source: 'kml' },
          geometry: {
            type: 'Point',
            coordinates: coords[0],
          },
        });
      }
    }
  }

  // Extract LineStrings
  const lines = doc.getElementsByTagName('LineString');
  for (let i = 0; i < lines.length; i++) {
    const coordsEl = lines[i].getElementsByTagName('coordinates')[0];
    if (coordsEl) {
      const coords = parseCoords(coordsEl.textContent || '');
      if (coords.length >= 2) {
        features.push({
          type: 'Feature',
          id: `kml-line-${i}`,
          properties: { source: 'kml' },
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
        });
      }
    }
  }

  // Extract Polygons
  const polygons = doc.getElementsByTagName('Polygon');
  for (let i = 0; i < polygons.length; i++) {
    const outerBoundary = polygons[i].getElementsByTagName('outerBoundaryIs')[0];
    if (outerBoundary) {
      const coordsEl = outerBoundary.getElementsByTagName('coordinates')[0];
      if (coordsEl) {
        const coords = parseCoords(coordsEl.textContent || '');
        if (coords.length >= 3) {
          features.push({
            type: 'Feature',
            id: `kml-polygon-${i}`,
            properties: { source: 'kml' },
            geometry: {
              type: 'Polygon',
              coordinates: [coords],
            },
          });
        }
      }
    }
  }

  if (features.length === 0) {
    throw new Error('No valid geometries found in KML file');
  }

  return features;
}

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
        const content = await file.text();
        let features: DrawnFeature[];

        if (extension === 'kml') {
          features = parseKML(content);
        } else {
          features = parseGeoJSON(content);
        }

        // Add input method to properties
        features = features.map((f) => ({
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
        setError(err instanceof Error ? err.message : 'Failed to parse file');
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
        <div style={{ fontSize: '24px', marginBottom: '8px' }}><i className="fa-solid fa-folder-open" /></div>
        <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
          {isDragActive ? 'Drop file here' : 'Click or drag file to upload'}
        </div>
        <div style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
          Supports GeoJSON (.json, .geojson) and KML (.kml)
        </div>
      </div>

      {error && <div style={errorStyle}>{error}</div>}
      {success && <div style={successStyle}>{success}</div>}
    </div>
  );
}
