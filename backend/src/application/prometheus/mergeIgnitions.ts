/**
 * Merge N ignitions into one shape the engine can burn (refs #294 slice 4).
 *
 * Franco's decision, verbatim: "yes merge - you can convert the point into a
 * tiny circle polygon. and it will work, make it about a single pixel in the
 * raster size. - including that when telling the user what we did, if we do
 * it."
 *
 * THE TRAP THIS EXISTS TO AVOID: a MultiPolygon's members are separate
 * fires. Appending a second ignition's rings onto the first polygon's ring
 * list turns it into a HOLE in the first — the fire silently stops burning
 * there instead of starting a second fire. Every ignition here becomes its
 * own MEMBER, never a ring of another member's polygon.
 *
 * A single ignition is untouched by this module — toExecutionOptions only
 * calls it once there is more than one, so a lone polygon or point never
 * gets wrapped in a MultiPolygon it does not need.
 */

import {
  GeometryType,
  SpatialGeometry,
  type MultiPolygonCoordinates,
  type PolygonCoordinates,
  type Position,
} from '../../domain/entities/index.js';
import type { IgnitionGeometry } from './toIgnitionGeometry.js';

/**
 * Nominal diameter of the circle a POINT ignition becomes when merged with
 * others, in metres. NOMINAL because the real pixel size
 * (`firestarr_data/dataset.json` -> `resolution_m: 100`) is read from the
 * fuel grid at runtime, in infrastructure — this module is application-layer
 * and must not reach into the fuel grid to ask. 100m is that dataset's own
 * documented resolution, named here as an assumption rather than hidden
 * behind a lookup this layer is not allowed to make.
 */
export const NOMINAL_POINT_IGNITION_DIAMETER_M = 100;

/** Vertices in the circle a POINT ignition becomes. Enough to look round. */
const CIRCLE_VERTICES = 16;

/** Mean Earth radius in metres — sizing the circle only, not reprojecting. */
const EARTH_RADIUS_M = 6371008.8;

export interface MergedIgnitions {
  /** Always a MultiPolygon — the caller only reaches this module for N > 1. */
  readonly geometry: SpatialGeometry;
  /**
   * One entry per ignition, naming it and exactly what was done to it. These
   * are how the operator learns the imported model differs from the file,
   * even when every ignition merged without error.
   */
  readonly notices: string[];
}

/**
 * A point ignition's circle, in degrees.
 *
 * Longitude degrees shrink by cos(latitude) — at 55.7N that is cos(55.7°) ≈
 * 0.562, so a naive equal-degree offset in both axes would make the circle
 * roughly 44% too narrow east-west. Dividing the longitude offset by
 * cos(latitude) corrects for that; the ring is a circle in metres, not in
 * degrees.
 */
function pointToCircleRing(lon: number, lat: number, diameterMeters: number): Position[] {
  const radiusMeters = diameterMeters / 2;
  const metersPerDegreeLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const latRad = (lat * Math.PI) / 180;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos(latRad);

  const dLat = radiusMeters / metersPerDegreeLat;
  const dLon = radiusMeters / metersPerDegreeLon;

  const ring: Position[] = [];
  for (let i = 0; i < CIRCLE_VERTICES; i++) {
    const theta = (2 * Math.PI * i) / CIRCLE_VERTICES;
    ring.push([lon + dLon * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  // Close the ring — GeoJSON/WKT polygons require first === last.
  ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

/**
 * Merges more than one ignition into a single MultiPolygon.
 *
 * @throws if given one or zero ignitions — the caller's job to only reach
 *   here for N > 1 — or if a LINE ignition appears among multiple, since
 *   merging it needs a buffer width the .fgmj never recorded.
 */
export function mergeIgnitions(geometries: IgnitionGeometry[]): MergedIgnitions {
  if (geometries.length <= 1) {
    throw new Error(
      'mergeIgnitions requires more than one ignition. A single ignition keeps ' +
        'its own geometry untouched — call it directly instead of merging.',
    );
  }

  const line = geometries.find((g) => g.geometry.type === GeometryType.LineString);
  if (line) {
    throw new Error(
      `Cannot merge ignition "${line.name}": it is a LINE among ${geometries.length} ` +
        'ignitions. Merging a line into a perimeter needs a buffer width around it, ' +
        'and the .fgmj never recorded one. Refusing rather than inventing a width.',
    );
  }

  const notices: string[] = [];
  const members: MultiPolygonCoordinates = [];

  for (const g of geometries) {
    if (g.geometry.type === GeometryType.Point) {
      const [lon, lat] = g.geometry.coordinates as Position;
      const ring = pointToCircleRing(lon, lat, NOMINAL_POINT_IGNITION_DIAMETER_M);
      members.push([ring]);
      notices.push(
        `Ignition "${g.name}" is a POINT. Merging ${geometries.length} ignitions into one ` +
          `run needs every ignition to be a shape, so it was converted to a circle polygon ` +
          `of a NOMINAL ${NOMINAL_POINT_IGNITION_DIAMETER_M} m diameter — about one pixel at ` +
          'the fuel grid’s resolution — centred on its original point.',
      );
    } else {
      // Polygon (POLYGON_OUT or POLYGON_IN). Kept as its OWN member, never
      // appended as a ring of another ignition's polygon.
      members.push(g.geometry.coordinates as PolygonCoordinates);
      notices.push(
        `Ignition "${g.name}" is a polygon. It was kept as its own separate member of ` +
          `the merged MultiPolygon — not combined with any other ignition's rings.`,
      );
    }
  }

  const geometry = new SpatialGeometry({
    type: GeometryType.MultiPolygon,
    coordinates: members,
  });

  return { geometry, notices };
}
