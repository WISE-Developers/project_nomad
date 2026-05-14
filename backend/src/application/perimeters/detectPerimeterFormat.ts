import { ValidationError } from '../../domain/errors/ValidationError.js';

export type PerimeterFormat = 'geojson' | 'kml';

const EXTENSIONS: Record<string, PerimeterFormat> = {
  geojson: 'geojson',
  json: 'geojson',
  kml: 'kml',
};

export function detectPerimeterFormat(filename: string): PerimeterFormat {
  const ext = filename.toLowerCase().split('.').pop();
  if (!ext || ext === filename.toLowerCase()) {
    throw ValidationError.forField(
      'filename',
      'must have a supported extension (.geojson, .json, .kml)',
      filename,
    );
  }
  const fmt = EXTENSIONS[ext];
  if (!fmt) {
    throw ValidationError.forField(
      'filename',
      `unsupported perimeter format: .${ext}`,
      filename,
    );
  }
  return fmt;
}
