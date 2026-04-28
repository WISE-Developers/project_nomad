/**
 * Web Mercator tile math (EPSG:3857).
 *
 * Used by the raster tile generators (`ArrivalTimeTileGenerator`,
 * `ContourGenerator`) to compute the SRS-correct extent each tile must
 * cover when warping a source raster.
 *
 * Why this matters (refs #242 spatial bias regression Apr 28 2026):
 * MapLibre/Mapbox raster tile sources position each (z, x, y) tile by
 * its standard Web Mercator extent. If we warp a source raster into a
 * tile using `-t_srs EPSG:4326 -te <lat/lon bounds>`, the tile's PNG
 * rows are evenly distributed in *latitude degrees* — but the renderer
 * positions those rows assuming they're evenly distributed in *Web
 * Mercator units*. At mid-latitudes (e.g. 55°N) the resulting
 * displacement is ~50–100 m, visible as a uniform N/S shift of every
 * raster layer relative to vector overlays. Fix: warp to EPSG:3857 and
 * pass Web Mercator bounds.
 */

/** Equatorial circumference in EPSG:3857 metres (2 * π * 6 378 137). */
export const EARTH_CIRCUMFERENCE_M = 40_075_016.685_578_488;

/** Half-circumference — distance from (0,0) to ±180° longitude in 3857. */
export const MERCATOR_ORIGIN_M = EARTH_CIRCUMFERENCE_M / 2;

export interface MercatorBounds {
  /** Western edge X in EPSG:3857 metres. */
  readonly west: number;
  /** Southern edge Y in EPSG:3857 metres. */
  readonly south: number;
  /** Eastern edge X in EPSG:3857 metres. */
  readonly east: number;
  /** Northern edge Y in EPSG:3857 metres. */
  readonly north: number;
}

/**
 * Returns the EPSG:3857 (Web Mercator) extent of a standard XYZ tile.
 *
 * Coordinate convention follows the OSM/MapLibre tile scheme:
 *   - tile (0, 0) at zoom 0 is the entire world
 *   - tile (x, y) increases east (x++) and south (y++)
 */
export function tileToMercatorBounds(z: number, x: number, y: number): MercatorBounds {
  const tileSize = EARTH_CIRCUMFERENCE_M / Math.pow(2, z);
  const west = x * tileSize - MERCATOR_ORIGIN_M;
  const east = (x + 1) * tileSize - MERCATOR_ORIGIN_M;
  const north = MERCATOR_ORIGIN_M - y * tileSize;
  const south = MERCATOR_ORIGIN_M - (y + 1) * tileSize;
  return { west, south, east, north };
}

/**
 * Expands the bounds outward by one source-pixel-equivalent (1/`tileSize` of
 * the tile's width on each side) so adjacent tiles overlap slightly and the
 * gdalwarp output has no transparent seams along tile edges.
 */
export function bufferMercatorBounds(b: MercatorBounds, tileSize: number): MercatorBounds {
  const xBuf = (b.east - b.west) / tileSize;
  const yBuf = (b.north - b.south) / tileSize;
  return {
    west: b.west - xBuf,
    east: b.east + xBuf,
    south: b.south - yBuf,
    north: b.north + yBuf,
  };
}
