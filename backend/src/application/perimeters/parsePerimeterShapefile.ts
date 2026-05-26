/**
 * Server-side shapefile perimeter parser (#269).
 *
 * Accepts either a zipped bundle (Buffer of a .zip containing
 * .shp/.shx/.dbf/.prj) or a raw multi-file payload (record of
 * filename -> Buffer). Returns a normalized WGS84 FeatureCollection.
 */

import type { PerimeterFeatureCollection } from './parsePerimeterGeoJSON.js';

export type ShapefileInput = Buffer | Record<string, Buffer>;

export async function parsePerimeterShapefile(
  _input: ShapefileInput,
): Promise<PerimeterFeatureCollection> {
  throw new Error('parsePerimeterShapefile: not implemented');
}
