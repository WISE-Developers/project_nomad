import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { ValidationError } from '../../domain/errors/ValidationError.js';

export type PerimeterFeatureCollection = FeatureCollection;

const SUPPORTED_GEOMETRY_TYPES = new Set(['Point', 'LineString', 'Polygon']);

export function parsePerimeterGeoJSON(input: string): PerimeterFeatureCollection {
  let json: unknown;
  try {
    json = JSON.parse(input);
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unknown parse error';
    throw ValidationError.forField('content', `must be valid JSON — ${detail}`);
  }

  if (!isObject(json) || typeof json.type !== 'string') {
    throw ValidationError.forField(
      'content',
      'must be a Feature, FeatureCollection, or geometry object',
    );
  }

  if (json.type === 'FeatureCollection' && Array.isArray(json.features)) {
    const features = (json.features as Feature[]).filter((f) =>
      SUPPORTED_GEOMETRY_TYPES.has(f.geometry?.type),
    );
    return { type: 'FeatureCollection', features };
  }

  if (json.type === 'Feature' && isObject(json.geometry)) {
    const geom = json.geometry as unknown as Geometry;
    if (SUPPORTED_GEOMETRY_TYPES.has(geom.type)) {
      return { type: 'FeatureCollection', features: [json as unknown as Feature] };
    }
  }

  if (SUPPORTED_GEOMETRY_TYPES.has(json.type)) {
    const feature: Feature = {
      type: 'Feature',
      id: `upload-${Date.now()}`,
      properties: {},
      geometry: json as unknown as Geometry,
    };
    return { type: 'FeatureCollection', features: [feature] };
  }

  throw ValidationError.forField(
    'content',
    'must be a Feature, FeatureCollection, or geometry object',
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
