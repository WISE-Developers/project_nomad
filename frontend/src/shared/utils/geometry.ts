import * as turf from '@turf/turf';
import type { Feature, LineString, Polygon, Position } from 'geojson';

/**
 * Calculate the length of a line in kilometers.
 *
 * @param line - GeoJSON LineString feature or coordinates
 * @returns Length in kilometers
 */
export function calculateLineLength(
  line: Feature<LineString> | Position[]
): number {
  const feature = Array.isArray(line)
    ? turf.lineString(line)
    : line;
  return turf.length(feature, { units: 'kilometers' });
}

/**
 * Calculate the area of a polygon in square kilometers.
 *
 * @param polygon - GeoJSON Polygon feature or coordinates
 * @returns Area in square kilometers
 */
export function calculatePolygonArea(
  polygon: Feature<Polygon> | Position[][]
): number {
  const feature = Array.isArray(polygon)
    ? turf.polygon(polygon)
    : polygon;
  return turf.area(feature) / 1_000_000; // Convert m² to km²
}

/**
 * Calculate the area of a polygon in hectares.
 *
 * @param polygon - GeoJSON Polygon feature or coordinates
 * @returns Area in hectares
 */
export function calculatePolygonAreaHectares(
  polygon: Feature<Polygon> | Position[][]
): number {
  return calculatePolygonArea(polygon) * 100; // 1 km² = 100 hectares
}

/**
 * Calculate the perimeter of a polygon in kilometers.
 *
 * @param polygon - GeoJSON Polygon feature or coordinates
 * @returns Perimeter in kilometers
 */
export function calculatePolygonPerimeter(
  polygon: Feature<Polygon> | Position[][]
): number {
  const feature = Array.isArray(polygon)
    ? turf.polygon(polygon)
    : polygon;
  const line = turf.polygonToLine(feature);
  if (line.type === 'FeatureCollection') {
    // MultiLineString case (polygon with holes)
    return line.features.reduce((total: number, f) => {
      return total + turf.length(f, { units: 'kilometers' });
    }, 0);
  }
  return turf.length(line, { units: 'kilometers' });
}

/**
 * Format distance for display.
 *
 * @param km - Distance in kilometers
 * @returns Formatted string with appropriate unit
 */
export function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(2)} km`;
}

/**
 * Format area for display.
 *
 * @param km2 - Area in square kilometers
 * @returns Formatted string with appropriate unit
 */
export function formatArea(km2: number): string {
  if (km2 < 0.01) {
    // Less than 1 hectare, show in m²
    return `${Math.round(km2 * 1_000_000)} m²`;
  }
  if (km2 < 1) {
    // Less than 1 km², show in hectares
    return `${(km2 * 100).toFixed(1)} ha`;
  }
  return `${km2.toFixed(2)} km²`;
}

/**
 * Calculate the centroid of a geometry.
 *
 * @param geometry - GeoJSON geometry
 * @returns Centroid coordinates [lng, lat]
 */
export function calculateCentroid(
  geometry: Feature<LineString | Polygon>
): [number, number] {
  const centroid = turf.centroid(geometry);
  return centroid.geometry.coordinates as [number, number];
}

/**
 * Calculate the bounding box of a geometry.
 *
 * @param geometry - GeoJSON geometry
 * @returns Bounding box [west, south, east, north]
 */
export function calculateBoundingBox(
  geometry: Feature<LineString | Polygon>
): [number, number, number, number] {
  return turf.bbox(geometry) as [number, number, number, number];
}
