import { ValidationError } from '../errors/index.js';

/**
 * Supported geometry types following GeoJSON specification
 */
export enum GeometryType {
  Point = 'Point',
  LineString = 'LineString',
  Polygon = 'Polygon',
  MultiPolygon = 'MultiPolygon',
}

/**
 * GeoJSON-compatible coordinate types
 */
export type Position = [number, number] | [number, number, number]; // [lon, lat] or [lon, lat, elevation]
export type PointCoordinates = Position;
export type LineStringCoordinates = Position[];
export type PolygonCoordinates = Position[][]; // Array of rings, first is exterior, rest are holes
// Array of MEMBERS, each a separate polygon's own ring list (exterior first,
// holes after). Rings within one member are exterior-then-holes; separate
// fires are separate members — never flatten a member into a ring of
// another, or it becomes a hole and silently stops that fire burning.
export type MultiPolygonCoordinates = PolygonCoordinates[];

/**
 * Union type for all coordinate formats
 */
export type Coordinates =
  | PointCoordinates
  | LineStringCoordinates
  | PolygonCoordinates
  | MultiPolygonCoordinates;

/**
 * Bounding box representation [minLon, minLat, maxLon, maxLat]
 */
export type BoundingBox = [number, number, number, number];

/**
 * Properties for creating a SpatialGeometry
 */
export interface SpatialGeometryProps {
  readonly type: GeometryType;
  readonly coordinates: Coordinates;
}

/**
 * Domain entity representing spatial geometry for fire modeling.
 *
 * Supports point ignitions, line ignitions, and polygon perimeters.
 * Follows GeoJSON coordinate conventions (longitude, latitude order).
 */
export class SpatialGeometry {
  /** The type of geometry */
  readonly type: GeometryType;

  /** GeoJSON-compatible coordinates */
  readonly coordinates: Coordinates;

  constructor(props: SpatialGeometryProps) {
    this.validateCoordinates(props.type, props.coordinates);
    this.type = props.type;
    this.coordinates = props.coordinates;
  }

  /**
   * Creates a point geometry from latitude and longitude
   */
  static fromPoint(latitude: number, longitude: number, elevation?: number): SpatialGeometry {
    const coords: Position = elevation !== undefined
      ? [longitude, latitude, elevation]
      : [longitude, latitude];
    return new SpatialGeometry({
      type: GeometryType.Point,
      coordinates: coords,
    });
  }

  /**
   * Creates a line geometry from an array of lat/lon pairs
   */
  static fromLineString(points: Array<{ lat: number; lon: number }>): SpatialGeometry {
    if (points.length < 2) {
      throw new Error('LineString requires at least 2 points');
    }
    const coords: LineStringCoordinates = points.map(p => [p.lon, p.lat]);
    return new SpatialGeometry({
      type: GeometryType.LineString,
      coordinates: coords,
    });
  }

  /**
   * Creates a polygon geometry from an array of lat/lon pairs (exterior ring)
   */
  static fromPolygon(exteriorRing: Array<{ lat: number; lon: number }>): SpatialGeometry {
    if (exteriorRing.length < 4) {
      throw new Error('Polygon exterior ring requires at least 4 points (first and last must match)');
    }
    const coords: PolygonCoordinates = [exteriorRing.map(p => [p.lon, p.lat])];
    return new SpatialGeometry({
      type: GeometryType.Polygon,
      coordinates: coords,
    });
  }

  /**
   * Calculates the bounding box of this geometry
   */
  getBoundingBox(): BoundingBox {
    const positions = this.getAllPositions();

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    for (const pos of positions) {
      minLon = Math.min(minLon, pos[0]);
      minLat = Math.min(minLat, pos[1]);
      maxLon = Math.max(maxLon, pos[0]);
      maxLat = Math.max(maxLat, pos[1]);
    }

    return [minLon, minLat, maxLon, maxLat];
  }

  /**
   * Gets the centroid of this geometry.
   * For polygons, calculates the true geometric centroid (center of mass).
   * For points and lines, uses simple average of vertices.
   */
  getCentroid(): Position {
    if (this.type === GeometryType.Polygon) {
      return this.getPolygonCentroid();
    }
    if (this.type === GeometryType.MultiPolygon) {
      return this.getMultiPolygonCentroid();
    }

    // For points and lines, use simple average
    const positions = this.getAllPositions();
    const sumLon = positions.reduce((sum, pos) => sum + pos[0], 0);
    const sumLat = positions.reduce((sum, pos) => sum + pos[1], 0);
    return [sumLon / positions.length, sumLat / positions.length];
  }

  /**
   * Calculates the true geometric centroid of a polygon using the
   * standard formula based on signed area.
   * Reference: https://en.wikipedia.org/wiki/Centroid#Of_a_polygon
   */
  private getPolygonCentroid(): Position {
    const rings = this.coordinates as PolygonCoordinates;
    const { cx, cy, signedArea } = SpatialGeometry.ringCentroidAndArea(rings[0]);

    // Handle degenerate case (zero area)
    if (Math.abs(signedArea) < 1e-10) {
      const ring = rings[0];
      const sumLon = ring.reduce((sum, pos) => sum + pos[0], 0);
      const sumLat = ring.reduce((sum, pos) => sum + pos[1], 0);
      return [sumLon / ring.length, sumLat / ring.length];
    }

    return [cx, cy];
  }

  /**
   * Area-weighted centroid across every MEMBER of a MultiPolygon — not an
   * average of member centroids, which would pull the result toward a tiny
   * member exactly as much as toward a large one. Each member's exterior
   * ring is used, matching getPolygonCentroid's own convention.
   *
   * Degenerate case: if every member has ~zero area (or there is only one
   * member and it is degenerate), fall back to a simple average of all
   * vertices across all members — the same fallback getPolygonCentroid uses
   * for a single polygon.
   */
  private getMultiPolygonCentroid(): Position {
    const members = this.coordinates as MultiPolygonCoordinates;

    let totalArea = 0;
    let weightedCx = 0;
    let weightedCy = 0;

    for (const member of members) {
      const { cx, cy, signedArea } = SpatialGeometry.ringCentroidAndArea(member[0]);
      const area = Math.abs(signedArea);
      totalArea += area;
      weightedCx += cx * area;
      weightedCy += cy * area;
    }

    if (totalArea < 1e-10) {
      const allPositions = members.flatMap((member) => member[0]);
      const sumLon = allPositions.reduce((sum, pos) => sum + pos[0], 0);
      const sumLat = allPositions.reduce((sum, pos) => sum + pos[1], 0);
      return [sumLon / allPositions.length, sumLat / allPositions.length];
    }

    return [weightedCx / totalArea, weightedCy / totalArea];
  }

  /**
   * Shared signed-area centroid formula for a single ring.
   * Reference: https://en.wikipedia.org/wiki/Centroid#Of_a_polygon
   */
  private static ringCentroidAndArea(ring: Position[]): { cx: number; cy: number; signedArea: number } {
    let signedArea = 0;
    let cx = 0;
    let cy = 0;

    const n = ring.length - 1; // Exclude closing point (duplicate of first)

    for (let i = 0; i < n; i++) {
      const x0 = ring[i][0];
      const y0 = ring[i][1];
      const x1 = ring[(i + 1) % n][0];
      const y1 = ring[(i + 1) % n][1];

      const a = x0 * y1 - x1 * y0;
      signedArea += a;
      cx += (x0 + x1) * a;
      cy += (y0 + y1) * a;
    }

    signedArea *= 0.5;

    if (Math.abs(signedArea) < 1e-10) {
      return { cx: 0, cy: 0, signedArea };
    }

    return { cx: cx / (6 * signedArea), cy: cy / (6 * signedArea), signedArea };
  }

  /**
   * Converts to GeoJSON format
   */
  toGeoJSON(): { type: string; coordinates: Coordinates } {
    return {
      type: this.type,
      coordinates: this.coordinates,
    };
  }

  /**
   * Check if this is a point geometry
   */
  isPoint(): boolean {
    return this.type === GeometryType.Point;
  }

  /**
   * Check if this is a line geometry
   */
  isLineString(): boolean {
    return this.type === GeometryType.LineString;
  }

  /**
   * Check if this is a polygon geometry
   */
  isPolygon(): boolean {
    return this.type === GeometryType.Polygon;
  }

  /**
   * Check if this is a MultiPolygon geometry
   */
  isMultiPolygon(): boolean {
    return this.type === GeometryType.MultiPolygon;
  }

  /**
   * Extracts all positions from the geometry regardless of type
   */
  private getAllPositions(): Position[] {
    switch (this.type) {
      case GeometryType.Point:
        return [this.coordinates as PointCoordinates];
      case GeometryType.LineString:
        return this.coordinates as LineStringCoordinates;
      case GeometryType.Polygon:
        // Flatten all rings
        return (this.coordinates as PolygonCoordinates).flat();
      case GeometryType.MultiPolygon:
        // Flatten every ring of every member
        return (this.coordinates as MultiPolygonCoordinates).flatMap((member) => member.flat());
    }
  }

  /**
   * Validates coordinates match the geometry type
   */
  private validateCoordinates(type: GeometryType, coordinates: Coordinates): void {
    switch (type) {
      case GeometryType.Point:
        this.validatePosition(coordinates as Position);
        break;
      case GeometryType.LineString:
        this.validateLineString(coordinates as LineStringCoordinates);
        break;
      case GeometryType.Polygon:
        this.validatePolygon(coordinates as PolygonCoordinates);
        break;
      case GeometryType.MultiPolygon:
        this.validateMultiPolygon(coordinates as MultiPolygonCoordinates);
        break;
    }
  }

  private validatePosition(pos: Position): void {
    if (!Array.isArray(pos) || pos.length < 2) {
      throw new ValidationError('Invalid position', [
        { field: 'coordinates', message: 'Position must be an array of at least 2 numbers [lon, lat]' },
      ]);
    }
    const [lon, lat] = pos;
    if (lon < -180 || lon > 180) {
      throw new ValidationError('Invalid coordinates', [
        { field: 'coordinates', message: `Longitude must be between -180 and 180, got ${lon}` },
      ]);
    }
    if (lat < -90 || lat > 90) {
      throw new ValidationError('Invalid coordinates', [
        { field: 'coordinates', message: `Latitude must be between -90 and 90, got ${lat}` },
      ]);
    }
  }

  private validateLineString(coords: LineStringCoordinates): void {
    if (!Array.isArray(coords) || coords.length < 2) {
      throw new ValidationError('Invalid geometry', [
        { field: 'coordinates', message: 'LineString requires at least 2 positions' },
      ]);
    }
    coords.forEach((pos, i) => {
      try {
        this.validatePosition(pos);
      } catch (e) {
        if (e instanceof ValidationError) throw e;
        throw new ValidationError('Invalid geometry', [
          { field: 'coordinates', message: `Invalid position at index ${i}: ${(e as Error).message}` },
        ]);
      }
    });
  }

  private validatePolygon(coords: PolygonCoordinates, memberIndex?: number): void {
    // When validating a MultiPolygon member, name it in every message so a
    // failure says which polygon and which ring, not just "ring 0".
    const label = memberIndex !== undefined ? `member ${memberIndex}, ring` : 'Ring';

    if (!Array.isArray(coords) || coords.length < 1) {
      throw new ValidationError('Invalid geometry', [
        {
          field: 'coordinates',
          message: memberIndex !== undefined
            ? `Member ${memberIndex} requires at least one ring`
            : 'Polygon requires at least one ring',
        },
      ]);
    }
    coords.forEach((ring, ringIndex) => {
      if (!Array.isArray(ring) || ring.length < 4) {
        throw new ValidationError('Invalid geometry', [
          { field: 'coordinates', message: `${label} ${ringIndex} requires at least 4 positions` },
        ]);
      }
      ring.forEach((pos, posIndex) => {
        try {
          this.validatePosition(pos);
        } catch (e) {
          if (e instanceof ValidationError) throw e;
          throw new ValidationError('Invalid geometry', [
            { field: 'coordinates', message: `Invalid position at ${label.toLowerCase()} ${ringIndex}, index ${posIndex}: ${(e as Error).message}` },
          ]);
        }
      });
      // Check if ring is closed
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        throw new ValidationError('Invalid geometry', [
          { field: 'coordinates', message: `${label} ${ringIndex} must be closed (first and last position must match)` },
        ]);
      }
    });
  }

  private validateMultiPolygon(members: MultiPolygonCoordinates): void {
    if (!Array.isArray(members) || members.length < 1) {
      throw new ValidationError('Invalid geometry', [
        { field: 'coordinates', message: 'MultiPolygon requires at least one member polygon' },
      ]);
    }
    members.forEach((member, memberIndex) => {
      this.validatePolygon(member, memberIndex);
    });
  }
}
