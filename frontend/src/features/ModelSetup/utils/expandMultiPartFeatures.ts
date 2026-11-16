/**
 * Expand multi-part GeoJSON into the single-part features the wizard carries
 * (#539, #540, #541).
 *
 * WHY THIS EXISTS AT THE BOUNDARY, and not in the layers below.
 *
 * `DrawnFeature` is `Feature<Point> | Feature<LineString> | Feature<Polygon>` —
 * a union of SINGLE-PART features (`features/Map/types/geometry.ts`). Nothing
 * downstream can describe a MultiPolygon, and every attempt to teach the layers
 * below about one requires widening that type and then handling the wider type
 * everywhere: `toRequestedIgnitions`, `ignitionLatitude`, `getBoundsFromFeatures`
 * and whatever is added next. Four sites were found by hand, one symptom at a
 * time, over three rounds of hitting them in the GUI.
 *
 * Expanding where the data ENTERS gives every layer below the single-part
 * guarantee it was already written against, so none of them changes.
 *
 * #537 taught `parsePerimeterGeoJSON` to accept MultiPolygon. That was right — a
 * fire with an unburned island, or several disjoint lobes, cannot be a single
 * Polygon, and every NWT VIIRS and GPS perimeter is a MultiPolygon. But it meant
 * multi-part geometry started arriving at a frontend that had never seen one.
 *
 * EXPANDING IS FAITHFUL, NOT CLEVER. Each part keeps its own rings, so a hole
 * stays a hole; collapsing a part's rings would burn the island. The backend
 * already accepts a list of ignitions and merges them (`mergeIgnitions`), and
 * merging is deliberately its job — combining them here would take away the
 * operator's chance to see on the map what the file actually declared.
 *
 * NOTHING IS DROPPED IN SILENCE. #537's other half was a filtered-to-nothing
 * collection returning a 201 that the UI rendered as "Successfully loaded 0
 * feature(s)" — a drop that reports success. Anything this cannot represent comes
 * back named in `unsupported`, for the caller to show.
 */

import type { DrawnFeature, DrawingMode } from '../../Map/types/geometry';

/** A GeoJSON feature as it arrives, before anything has vouched for its type. */
export interface IncomingFeature {
  type: 'Feature';
  properties?: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown };
}

export interface ExpandedFeatures {
  /** Single-part features, safe for every layer below. */
  features: DrawnFeature[];
  /** Human-readable reasons a feature could not be carried. Never silent. */
  unsupported: string[];
}

/** The wizard's drawing mode for each single-part geometry it can carry. */
const MODE_FOR: Record<string, DrawingMode> = {
  Point: 'point',
  LineString: 'line',
  Polygon: 'polygon',
};

/**
 * The single-part type each multi-part type expands into, and how to split it.
 *
 * A table rather than a switch because the relationship IS the data: adding a
 * type here is the whole change, and there is no second list to keep in step.
 */
const MULTI_PART: Record<string, { single: string; parts: (coordinates: unknown) => unknown[] }> = {
  MultiPoint: { single: 'Point', parts: (c) => c as unknown[] },
  MultiLineString: { single: 'LineString', parts: (c) => c as unknown[] },
  MultiPolygon: { single: 'Polygon', parts: (c) => c as unknown[] },
};

function describe(feature: IncomingFeature): string {
  const name = feature.properties?.name;
  return typeof name === 'string' && name.length > 0 ? `"${name}"` : 'A feature';
}

/**
 * Builds one single-part DrawnFeature.
 *
 * Built per geometry type rather than cast: `DrawnFeature` is a union of
 * `Feature<Point> | Feature<LineString> | Feature<Polygon>`, not a `Feature` of a
 * union, so a single cast would compile only by lying about the narrowing — which
 * is exactly what `GeometryUpload`'s `as { features: DrawnFeature[] }` was doing.
 */
function singlePart(
  type: string,
  coordinates: unknown,
  properties: Record<string, unknown>,
): DrawnFeature | undefined {
  const mode = MODE_FOR[type];
  if (!mode) return undefined;
  // `properties.mode` is required by TerraDraw, which ignores a feature without
  // it — so the geometry would simply not appear on the map.
  const props = { ...properties, mode };

  switch (type) {
    case 'Point':
      return {
        type: 'Feature',
        properties: props,
        geometry: { type: 'Point', coordinates: coordinates as [number, number] },
      };
    case 'LineString':
      return {
        type: 'Feature',
        properties: props,
        geometry: { type: 'LineString', coordinates: coordinates as [number, number][] },
      };
    case 'Polygon':
      return {
        type: 'Feature',
        properties: props,
        geometry: { type: 'Polygon', coordinates: coordinates as [number, number][][] },
      };
    default:
      return undefined;
  }
}

export function expandMultiPartFeatures(incoming: IncomingFeature[]): ExpandedFeatures {
  const features: DrawnFeature[] = [];
  const unsupported: string[] = [];

  for (const feature of incoming) {
    const geometryType = feature.geometry?.type;
    const properties = { ...(feature.properties ?? {}) };

    const multi = MULTI_PART[geometryType];
    if (multi) {
      const parts = multi.parts(feature.geometry.coordinates) ?? [];
      if (!Array.isArray(parts) || parts.length === 0) {
        // An empty multi-part geometry is a failed read, not a success with
        // nothing in it. Reporting it is the #537 lesson.
        unsupported.push(
          `${describe(feature)} is a ${geometryType} with no parts, so there is no geometry to carry.`,
        );
        continue;
      }
      for (const part of parts) {
        const built = singlePart(multi.single, part, properties);
        if (built) features.push(built);
      }
      continue;
    }

    const built = singlePart(geometryType, feature.geometry.coordinates, properties);
    if (built) {
      features.push(built);
      continue;
    }

    unsupported.push(
      `${describe(feature)} is a ${geometryType ?? 'geometry with no type'}, which the setup form cannot draw or carry.`,
    );
  }

  return { features, unsupported };
}
