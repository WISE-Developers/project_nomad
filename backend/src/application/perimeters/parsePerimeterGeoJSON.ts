import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { ValidationError } from '../../domain/errors/ValidationError.js';
import { GeometryType } from '../../domain/entities/SpatialGeometry.js';

export type PerimeterFeatureCollection = FeatureCollection;

/**
 * The multi-part types this parser DECOMPOSES, and the single-part type each becomes.
 *
 * #547: the accepted set and the set of types anything downstream can represent were
 * two lists kept in agreement by hand, and they had already drifted once at real cost
 * (#537). They are now one derived chain, and this table is its only hand-written link:
 * a type belongs here exactly when the domain cannot represent it.
 *
 * MULTIPOLYGON IS DELIBERATELY ABSENT, and that is the whole point of the rule.
 * A model carries ONE ignition geometry, and the engine hands that geometry to the
 * rasterizer when it is supported (`FireSTARREngine`), where `geometryToWKT` burns
 * every member and every hole into one `perimeter.tif`. A MultiPolygon is therefore
 * representable end to end — it is in `GeometryType` AND in `PERIMETER_GEOMETRY_TYPES`
 * — so splitting a two-lobed fire into two features would mean one lobe reaching the
 * engine and the other being dropped at the single-geometry boundary. The frontend
 * splits them only because its draw layer cannot hold a multi-part feature; that is a
 * display constraint, not the engine's. The test for this states it, so the table
 * cannot be "tidied" for symmetry.
 *
 * MultiPoint and MultiLineString appear in neither the domain enum nor the rasterizer's
 * list, so they are decomposed HERE, where the file enters the server, rather than
 * being passed through for the client to normalize — the defect class of #539, and the
 * reason the MCP and ZIP-import paths had no expansion at all.
 */
export const MULTI_PART_EXPANSIONS: Readonly<Record<string, GeometryType>> = {
  MultiPoint: GeometryType.Point,
  MultiLineString: GeometryType.LineString,
};

/**
 * Geometry types this parser accepts: what the domain can represent, plus what this
 * parser can turn INTO something the domain can represent. Derived, never typed out.
 *
 * `GeometryCollection` is still excluded deliberately: it has no single coordinate
 * array, so the downstream ignition flow has nothing to consume. It REFUSES rather
 * than being dropped in silence (#537).
 */
export const PARSER_ACCEPTED_GEOMETRY_TYPES: ReadonlySet<string> = new Set<string>([
  ...Object.values(GeometryType),
  ...Object.keys(MULTI_PART_EXPANSIONS),
]);

/** Back-compat alias for the name this set used before #547. */
const SUPPORTED_GEOMETRY_TYPES = PARSER_ACCEPTED_GEOMETRY_TYPES;

/**
 * Expands one feature into the features a downstream consumer can represent.
 *
 * Returns [] when the feature can produce nothing — an unsupported type, or a
 * multi-part geometry with no members. An empty result is a DROP, and the caller
 * turns an all-dropped collection into an error rather than an empty success (#537).
 * A geometry kept whole is still checked for emptiness: kept whole is not kept
 * unchecked, and passing an empty MultiPolygon through would move the failure to the
 * engine, where it reads as a rasterization fault instead of a bad upload.
 */
function expandFeature(feature: Feature): Feature[] {
  const type = feature.geometry?.type;
  if (!type || !SUPPORTED_GEOMETRY_TYPES.has(type)) return [];

  const coordinates = (feature.geometry as { coordinates?: unknown }).coordinates;
  if (Array.isArray(coordinates) && coordinates.length === 0) return [];

  const singleType = MULTI_PART_EXPANSIONS[type];
  if (!singleType) return [feature];

  if (!Array.isArray(coordinates)) return [];

  return coordinates.map((part, index) => ({
    ...feature,
    id: feature.id !== undefined ? `${feature.id}-${index + 1}` : undefined,
    properties: { ...(feature.properties ?? {}) },
    geometry: { type: singleType, coordinates: part } as unknown as Geometry,
  }));
}

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
    const features = all.flatMap(expandFeature);

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

  // The three entry shapes must agree, so each runs through the same expansion.
  if (json.type === 'Feature' && isObject(json.geometry)) {
    const geom = json.geometry as unknown as Geometry;
    if (SUPPORTED_GEOMETRY_TYPES.has(geom.type)) {
      const expanded = expandFeature(json as unknown as Feature);
      if (expanded.length > 0) {
        return { type: 'FeatureCollection', features: expanded };
      }
      throw ValidationError.forField(
        'content',
        `contains no supported geometry — the ${geom.type} had no members. ` +
          `Supported: ${[...SUPPORTED_GEOMETRY_TYPES].join(', ')}.`,
      );
    }
  }

  if (SUPPORTED_GEOMETRY_TYPES.has(json.type)) {
    const feature: Feature = {
      type: 'Feature',
      id: `upload-${Date.now()}`,
      properties: {},
      geometry: json as unknown as Geometry,
    };
    const expanded = expandFeature(feature);
    if (expanded.length > 0) {
      return { type: 'FeatureCollection', features: expanded };
    }
    throw ValidationError.forField(
      'content',
      `contains no supported geometry — the ${json.type} had no members. ` +
        `Supported: ${[...SUPPORTED_GEOMETRY_TYPES].join(', ')}.`,
    );
  }

  throw ValidationError.forField(
    'content',
    'must be a Feature, FeatureCollection, or geometry object',
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
