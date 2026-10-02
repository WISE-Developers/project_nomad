/**
 * Merge N ignitions into one shape the engine can burn (refs #294).
 *
 * Application-layer and engine-neutral. It began life beside the .fgmj
 * importer, but merging ignitions is not a Prometheus concern — the ordinary
 * run path merges hand-drawn ignitions through exactly this code, so it lives
 * here rather than under prometheus/ (Franco, 2026-10-02).
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
/**
 * One named ignition to merge.
 *
 * Declared here rather than imported from the .fgmj importer so this module
 * depends on nothing above it. The importer's IgnitionGeometry satisfies it
 * structurally, and so does anything the wizard sends.
 */
export interface NamedIgnition {
  name: string;
  geometry: SpatialGeometry;
}

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

/**
 * Nominal width of the corridor a LINE ignition becomes when merged, in
 * metres. The same nominal cell size as the point circle, for the same reason.
 *
 * A line has no width, exactly as a point has no extent. FireSTARR never sees
 * the vector — it burns a rasterized perimeter — so at a 100 m grid a 100 m
 * corridor covers essentially the cells the rasterizer's own Bresenham trace
 * would cover for a lone line ignition.
 */
const NOMINAL_LINE_IGNITION_WIDTH_M = NOMINAL_POINT_IGNITION_DIAMETER_M;

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
 * A LINE ignition as a corridor of nominal width, one quad member per segment.
 *
 * Per-segment quads rather than a true polygon offset: a real buffer needs
 * mitred joins and end caps, and getting those wrong puts burning ground
 * somewhere the line never went. Overlapping quads at the joins are harmless —
 * the rasterizer accumulates burned cells into a Set, so a cell covered twice
 * burns once.
 *
 * Each quad is its own MEMBER, never a ring of another member, for the same
 * reason every other ignition is: a ring would be read as a hole.
 *
 * Zero-length segments are skipped; they have no direction to offset along.
 */
function lineToCorridorMembers(points: Position[], widthMeters: number): PolygonCoordinates[] {
  const halfWidth = widthMeters / 2;
  const metersPerDegreeLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const members: PolygonCoordinates[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const [lonA, latA] = points[i];
    const [lonB, latB] = points[i + 1];

    // Work the offset in metres, then convert back — longitude degrees shrink
    // by cos(latitude), and at 60N that is a factor of two.
    const midLatRad = (((latA + latB) / 2) * Math.PI) / 180;
    const metersPerDegreeLon = metersPerDegreeLat * Math.cos(midLatRad);

    const dxMeters = (lonB - lonA) * metersPerDegreeLon;
    const dyMeters = (latB - latA) * metersPerDegreeLat;
    const length = Math.hypot(dxMeters, dyMeters);
    if (length === 0) continue;

    // Unit normal to the segment, in metres, then back into degrees.
    const nxMeters = (-dyMeters / length) * halfWidth;
    const nyMeters = (dxMeters / length) * halfWidth;
    const nLon = nxMeters / metersPerDegreeLon;
    const nLat = nyMeters / metersPerDegreeLat;

    const quad: Position[] = [
      [lonA + nLon, latA + nLat],
      [lonB + nLon, latB + nLat],
      [lonB - nLon, latB - nLat],
      [lonA - nLon, latA - nLat],
    ];
    // Close the ring — GeoJSON/WKT polygons require first === last.
    quad.push([quad[0][0], quad[0][1]]);
    members.push([quad]);
  }

  return members;
}

/**
 * Merges more than one ignition into a single MultiPolygon.
 *
 * @throws if given one or zero ignitions — the caller's job to only reach
 *   here for N > 1 — or if an ignition carries no usable geometry at all.
 */
export function mergeIgnitions(geometries: NamedIgnition[]): MergedIgnitions {
  if (geometries.length <= 1) {
    throw new Error(
      'mergeIgnitions requires more than one ignition. A single ignition keeps ' +
        'its own geometry untouched — call it directly instead of merging.',
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
    } else if (g.geometry.type === GeometryType.LineString) {
      const quads = lineToCorridorMembers(
        g.geometry.coordinates as Position[],
        NOMINAL_LINE_IGNITION_WIDTH_M,
      );
      if (quads.length === 0) {
        throw new Error(
          `Ignition "${g.name}" is a LINE whose points are all in the same place, ` +
            'so it has no direction to give width to. Refusing rather than guessing one.',
        );
      }
      members.push(...quads);
      notices.push(
        `Ignition "${g.name}" is a LINE. Merging ${geometries.length} ignitions into one ` +
          'run needs every ignition to be a shape, so it was widened into a corridor of ' +
          `a NOMINAL ${NOMINAL_LINE_IGNITION_WIDTH_M} m — about one pixel at the fuel ` +
          `grid’s resolution — along its length (${quads.length} segment` +
          `${quads.length === 1 ? '' : 's'}).`,
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
