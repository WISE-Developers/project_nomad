import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { ValidationError } from '../../domain/errors/ValidationError.js';

export type PerimeterFeatureCollection = FeatureCollection;

/**
 * Geometry types this parser accepts.
 *
 * THE MULTI-PART TYPES ARE NOT OPTIONAL (#537). Every NWT VIIRS and GPS perimeter we
 * handle arrives as a `MultiPolygon` — a fire with an unburned island, or several
 * disjoint lobes, cannot be expressed as a single `Polygon`. Omitting them meant a real
 * perimeter file parsed to zero features and the UI reported
 * "Successfully loaded 0 feature(s)".
 *
 * `GeometryCollection` is still excluded deliberately: it has no single coordinate
 * array, so the downstream ignition flow has nothing to consume. It now REFUSES rather
 * than being dropped in silence.
 */
const SUPPORTED_GEOMETRY_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
]);

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
    const all = json.features as Feature[];
    const features = all.filter((f) => SUPPORTED_GEOMETRY_TYPES.has(f.geometry?.type));

    // DROPPING EVERY FEATURE IS A FAILURE, NOT AN EMPTY RESULT (#537). Returning the
    // filtered-to-nothing collection produced a 201 that the UI rendered as
    // "Successfully loaded 0 feature(s)" — a silent default in the exact shape that
    // makes a broken upload look like an empty file. An EMPTY input collection is
    // still accepted, because the caller sent nothing and nothing came back; it is
    // only the all-dropped case that lies.
    if (features.length === 0 && all.length > 0) {
      const dropped = [...new Set(all.map((f) => f.geometry?.type ?? 'missing geometry'))];
      throw ValidationError.forField(
        'content',
        `contains no supported geometry — every feature was ${dropped.join(', ')}. ` +
          `Supported: ${[...SUPPORTED_GEOMETRY_TYPES].join(', ')}.`,
      );
    }

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
