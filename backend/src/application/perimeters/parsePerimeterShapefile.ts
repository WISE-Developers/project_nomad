/**
 * Server-side shapefile perimeter parser (#269).
 *
 * Accepts either a zipped bundle (Buffer of a .zip containing
 * .shp/.shx/.dbf/.prj) or a raw multi-file payload (record of
 * filename -> Buffer). Returns a normalized WGS84 FeatureCollection.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { ValidationError, type FieldError } from '../../domain/errors/ValidationError.js';
import type { PerimeterFeatureCollection } from './parsePerimeterGeoJSON.js';

export type ShapefileInput = Buffer | Record<string, Buffer>;

const REQUIRED_SIDECARS = ['shp', 'shx', 'dbf', 'prj'] as const;
const BASENAME = 'fixture';

interface ExtractedBundle {
  /** Map of lowercase extension (no dot) -> file buffer */
  byExt: Record<string, Buffer>;
}

function isBuffer(v: unknown): v is Buffer {
  return Buffer.isBuffer(v);
}

function extractZip(zipBuf: Buffer): ExtractedBundle {
  const byExt: Record<string, Buffer> = {};
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuf);
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unknown zip error';
    throw ValidationError.forField('content', `must be a valid zip archive — ${detail}`);
  }
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.split('/').pop() ?? entry.entryName;
    const ext = name.toLowerCase().split('.').pop();
    if (!ext || ext === name.toLowerCase()) continue;
    if (!(ext in byExt)) {
      byExt[ext] = entry.getData();
    }
  }
  return { byExt };
}

function extractRecord(record: Record<string, Buffer>): ExtractedBundle {
  const byExt: Record<string, Buffer> = {};
  for (const [name, buf] of Object.entries(record)) {
    const ext = name.toLowerCase().split('.').pop();
    if (!ext || ext === name.toLowerCase()) continue;
    if (!(ext in byExt)) byExt[ext] = buf;
  }
  return { byExt };
}

function checkSidecars(bundle: ExtractedBundle): void {
  const missing: FieldError[] = [];
  for (const ext of REQUIRED_SIDECARS) {
    if (!bundle.byExt[ext]) {
      missing.push({
        field: ext,
        message: `missing required shapefile sidecar: .${ext}`,
      });
    }
  }
  if (missing.length > 0) {
    throw ValidationError.forFields(missing);
  }
}

function writeBundleToTmp(bundle: ExtractedBundle): { dir: string; shpPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shp-import-'));
  for (const ext of Object.keys(bundle.byExt)) {
    fs.writeFileSync(path.join(dir, `${BASENAME}.${ext}`), bundle.byExt[ext]);
  }
  return { dir, shpPath: path.join(dir, `${BASENAME}.shp`) };
}

async function readShapefileFeatures(shpPath: string): Promise<Feature[]> {
  const gdalModule = await import('gdal-async');
  const gdal = gdalModule.default;

  const ds = gdal.open(shpPath);
  try {
    if (ds.layers.count() === 0) {
      throw ValidationError.forField('content', 'shapefile contains no layers');
    }
    const layer = ds.layers.get(0);
    const wgs84 = gdal.SpatialReference.fromEPSG(4326);
    const srcSrs = layer.srs;
    if (!srcSrs) {
      throw ValidationError.forField(
        'prj',
        'CRS could not be read from .prj — projection is missing or unreadable',
      );
    }
    const needsReproject = srcSrs.toWKT() !== wgs84.toWKT();
    const transform = needsReproject
      ? new gdal.CoordinateTransformation(srcSrs, wgs84)
      : null;

    const features: Feature[] = [];
    let idx = 0;
    layer.features.forEach((f) => {
      const geom = f.getGeometry();
      if (!geom) return;
      if (transform) {
        geom.transform(transform);
      }
      const geojson = geom.toObject() as { type: string };
      if (geojson.type !== 'Polygon' && geojson.type !== 'MultiPolygon') {
        throw ValidationError.forField(
          'geometry',
          `must be Polygon or MultiPolygon — got ${geojson.type}`,
        );
      }
      const polyGeom = geojson as Polygon | MultiPolygon;
      assertWgs84Range(polyGeom);
      features.push({
        type: 'Feature',
        id: `shapefile-${idx++}`,
        properties: { source: 'shapefile' },
        geometry: polyGeom,
      });
    });
    return features;
  } finally {
    ds.close();
  }
}


function assertWgs84Range(geom: Polygon | MultiPolygon): void {
  const rings: number[][][] =
    geom.type === 'Polygon'
      ? geom.coordinates
      : geom.coordinates.flat();
  for (const ring of rings) {
    for (const pt of ring) {
      const [lon, lat] = pt;
      if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        lon < -180 ||
        lon > 180 ||
        lat < -90 ||
        lat > 90
      ) {
        throw ValidationError.forField(
          'coordinates',
          `coordinate (${lon}, ${lat}) is outside plausible WGS84 range — lon must be in [-180, 180], lat in [-90, 90]`,
        );
      }
    }
  }
}

export async function parsePerimeterShapefile(
  input: ShapefileInput,
): Promise<PerimeterFeatureCollection> {
  const bundle = isBuffer(input) ? extractZip(input) : extractRecord(input);
  checkSidecars(bundle);

  const { dir, shpPath } = writeBundleToTmp(bundle);
  try {
    const features = await readShapefileFeatures(shpPath);
    if (features.length === 0) {
      throw ValidationError.forField('content', 'no valid geometries found in shapefile');
    }
    return { type: 'FeatureCollection', features };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
