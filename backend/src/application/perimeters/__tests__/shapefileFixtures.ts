/**
 * Programmatic shapefile fixture builders for #269 tests.
 *
 * Generates real shapefiles on disk using gdal-async, then returns
 * either the individual sidecars as a Record<filename, Buffer> or
 * a zipped Buffer. Files are written to a temp dir to keep
 * binary artifacts out of git.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import gdal from 'gdal-async';

export interface BuildOpts {
  /** EPSG code for the source SRS. Defaults to 4326. Use null to skip writing .prj. */
  epsg?: number | null;
  /** Geometry type: 'polygon' or 'point'. Defaults to 'polygon'. */
  geometry?: 'polygon' | 'point';
  /** Rings (polygon) or points (point) as [lon, lat] tuples in source SRS. */
  coordinates?: Array<[number, number]>;
}

const DEFAULT_RING: Array<[number, number]> = [
  [-115.7, 60.8],
  [-115.7, 60.81],
  [-115.69, 60.81],
  [-115.69, 60.8],
  [-115.7, 60.8],
];

/**
 * Build a shapefile and return its sidecar files as a Record.
 * The caller may then optionally zip them.
 */
export function buildShapefileFiles(opts: BuildOpts = {}): Record<string, Buffer> {
  const epsg = opts.epsg === undefined ? 4326 : opts.epsg;
  const geomKind = opts.geometry ?? 'polygon';
  const coords = opts.coordinates ?? DEFAULT_RING;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shpfix-'));
  const base = path.join(dir, 'fixture');
  const drv = gdal.drivers.get('ESRI Shapefile');
  const srs = epsg === null ? null : gdal.SpatialReference.fromEPSG(epsg);
  const ds = drv.create(base + '.shp', 0, 0, 0, gdal.GDT_Unknown);
  const wkb = geomKind === 'point' ? gdal.wkbPoint : gdal.wkbPolygon;
  const layer = ds.layers.create('fixture', srs, wkb);

  if (geomKind === 'polygon') {
    const ring = new gdal.LinearRing();
    for (const [x, y] of coords) ring.points.add(x, y);
    const poly = new gdal.Polygon();
    poly.rings.add(ring);
    const feat = new gdal.Feature(layer);
    feat.setGeometry(poly);
    layer.features.add(feat);
  } else {
    for (const [x, y] of coords) {
      const pt = new gdal.Point(x, y);
      const feat = new gdal.Feature(layer);
      feat.setGeometry(pt);
      layer.features.add(feat);
    }
  }
  ds.flush();
  ds.close();

  const out: Record<string, Buffer> = {};
  for (const entry of fs.readdirSync(dir)) {
    out[entry] = fs.readFileSync(path.join(dir, entry));
  }
  fs.rmSync(dir, { recursive: true, force: true });

  if (epsg === null) {
    delete out['fixture.prj'];
  }
  return out;
}

export function zipShapefileFiles(files: Record<string, Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, buf] of Object.entries(files)) {
    zip.addFile(name, buf);
  }
  return zip.toBuffer();
}

export function buildShapefileZip(opts: BuildOpts = {}): Buffer {
  return zipShapefileFiles(buildShapefileFiles(opts));
}
