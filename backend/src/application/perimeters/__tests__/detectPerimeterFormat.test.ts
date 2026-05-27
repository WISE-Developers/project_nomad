/**
 * Tests for detectPerimeterFormat (refs #267).
 */

import { describe, it, expect } from 'vitest';
import { detectPerimeterFormat } from '../detectPerimeterFormat.js';
import { ValidationError } from '../../../domain/errors/ValidationError.js';

describe('detectPerimeterFormat', () => {
  it('resolves .geojson to geojson', () => {
    expect(detectPerimeterFormat('ignition.geojson')).toBe('geojson');
  });

  it('resolves .json to geojson', () => {
    expect(detectPerimeterFormat('ignition.json')).toBe('geojson');
  });

  it('resolves .kml to kml', () => {
    expect(detectPerimeterFormat('ignition.kml')).toBe('kml');
  });

  it('is case-insensitive', () => {
    expect(detectPerimeterFormat('IGNITION.GeoJSON')).toBe('geojson');
    expect(detectPerimeterFormat('IGNITION.KML')).toBe('kml');
  });

  it('resolves .shp to shapefile', () => {
    expect(detectPerimeterFormat('ignition.shp')).toBe('shapefile');
  });

  it('resolves .zip to shapefile (bundled sidecars)', () => {
    expect(detectPerimeterFormat('ignition.zip')).toBe('shapefile');
  });

  it('throws ValidationError for an unknown extension', () => {
    expect(() => detectPerimeterFormat('ignition.xyz')).toThrow(ValidationError);
  });

  it('throws ValidationError for a file with no extension', () => {
    expect(() => detectPerimeterFormat('ignition')).toThrow(ValidationError);
  });
});
