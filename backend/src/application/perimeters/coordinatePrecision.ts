/**
 * Coordinate precision normalization.
 *
 * TerraDraw on the frontend rejects features with more than 9 decimal places
 * of precision. GDAL reprojection (gdal-async) and some KML sources produce
 * Float64-precision values (15-17 decimals), which fail validation.
 *
 * 9 decimals ≈ 0.1 mm at the equator — well beyond what fire perimeter data
 * needs.
 */
import type { Polygon, MultiPolygon, Position } from 'geojson';

export const COORD_PRECISION = 9;

export function roundCoord(n: number): number {
  return Number(n.toFixed(COORD_PRECISION));
}

export function roundPosition(pos: Position): Position {
  return [roundCoord(pos[0]), roundCoord(pos[1]), ...(pos.length > 2 ? [roundCoord(pos[2]!)] : [])];
}

export function roundPolygonCoordinates(geom: Polygon | MultiPolygon): void {
  if (geom.type === 'Polygon') {
    for (let i = 0; i < geom.coordinates.length; i++) {
      geom.coordinates[i] = geom.coordinates[i].map(roundPosition);
    }
  } else {
    for (let p = 0; p < geom.coordinates.length; p++) {
      for (let i = 0; i < geom.coordinates[p].length; i++) {
        geom.coordinates[p][i] = geom.coordinates[p][i].map(roundPosition);
      }
    }
  }
}
