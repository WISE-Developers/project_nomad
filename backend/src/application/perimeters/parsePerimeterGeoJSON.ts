import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { ValidationError } from '../../domain/errors/ValidationError.js';

export type PerimeterFeatureCollection = FeatureCollection<Polygon | MultiPolygon>;

export function parsePerimeterGeoJSON(input: string): PerimeterFeatureCollection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw ValidationError.forField('content', 'must be valid JSON');
  }
  return parsed as PerimeterFeatureCollection;
}
