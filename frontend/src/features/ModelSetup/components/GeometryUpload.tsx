/**
 * GeometryUpload Component
 *
 * Upload GeoJSON, KML, or Shapefile (zipped or raw multi-file) files to
 * import geometry. Files are POSTed to the unified server endpoint
 * /api/v1/perimeters/import which auto-detects format from filename.
 *
 * Shapefiles can be provided either as a single .zip bundle, or by selecting
 * the raw .shp + sidecar files together; the component zips raw selections
 * client-side before upload because the backend accepts a single file.
 */

import React, { useState, useCallback, useRef } from 'react';
import JSZip from 'jszip';
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

const SHAPEFILE_SIDECAR_EXTENSIONS = ['shp', 'shx', 'dbf', 'prj', 'cpg', 'sbn', 'sbx'];
const SINGLE_FILE_EXTENSIONS = ['json', 'geojson', 'kml', 'zip'];

function getExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** Zip a raw multi-file shapefile selection into a single Blob for upload. */
async function zipShapefileFiles(files: File[]): Promise<Blob> {
  const zip = new JSZip();
  for (const f of files) {
    // Pass the File/Blob directly — JSZip handles streaming the contents.
    // (Avoid f.arrayBuffer() because some test environments lack it on File.)
    zip.file(f.name, f);
  }
  return zip.generateAsync({ type: 'blob' });
}

/**
 * Component for uploading geometry files (GeoJSON / KML / Shapefile).
 */
export function GeometryUpload({ onUpload }: GeometryUploadProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const postFile = useCallback(
    async (uploadFile: File | Blob, fileName: string) => {
      const form = new FormData();
      form.append('file', uploadFile, fileName);
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
          fileName,
        },
      }));

      setSuccess(`Successfully loaded ${features.length} feature(s) from ${fileName}`);
      onUpload(features);
    },
    [onUpload]
  );

  const processFiles = useCallback(
    async (files: File[]) => {
      setError('');
      setSuccess('');

      if (files.length === 0) return;

      // Multi-file selection — assumed to be a raw shapefile bundle.
      if (files.length > 1) {
        const extensions = files.map((f) => getExtension(f.name));
        if (!extensions.includes('shp')) {
          setError(
            'Multi-file uploads must include a .shp file (with sidecars: .shx, .dbf, .prj).'
          );
          return;
        }
        try {
          const baseName = files.find((f) => getExtension(f.name) === 'shp')!.name.replace(
            /\.shp$/i,
            ''
          );
          const zipBlob = await zipShapefileFiles(files);
          await postFile(zipBlob, `${baseName}.zip`);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to upload shapefile bundle');
        }
        return;
      }

      // Single-file selection — must be one of the supported single-file formats.
      const file = files[0];
      const extension = getExtension(file.name);

      if (!SINGLE_FILE_EXTENSIONS.includes(extension)) {
        setError(
          'Unsupported file format. Please use GeoJSON (.json, .geojson), KML (.kml), or Shapefile (.zip).'
        );
        return;
      }

      try {
        await postFile(file, file.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload file');
      }
    },
    [postFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragActive(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        processFiles(files);
      }
    },
    [processFiles]
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
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        processFiles(files);
      }
    },
    [processFiles]
  );

  const acceptAttr = [
    ...SINGLE_FILE_EXTENSIONS.map((e) => `.${e}`),
    ...SHAPEFILE_SIDECAR_EXTENSIONS.map((e) => `.${e}`),
  ].join(',');

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
          accept={acceptAttr}
          multiple
          onChange={handleFileChange}
          style={{ display: 'none' }}
          title="Upload GeoJSON, KML, or Shapefile (zip or .shp + sidecars)"
        />
        <div style={{ fontSize: '24px', marginBottom: '8px', color: '#666' }}>
          <i className="fa-solid fa-folder-open" />
        </div>
        <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#333' }}>
          {isDragActive ? 'Drop file here' : 'Click or drag file to upload'}
        </div>
        <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
          Supports GeoJSON (.json, .geojson), KML (.kml), and Shapefile (.zip, or
          select .shp + sidecars together)
        </div>
      </div>

      {error && <div style={errorStyle}>{error}</div>}
      {success && <div style={successStyle}>{success}</div>}
    </div>
  );
}
