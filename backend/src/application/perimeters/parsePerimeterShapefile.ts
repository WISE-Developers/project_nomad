/**
 * Server-side shapefile perimeter parser (#269).
 *
 * Accepts either a zipped bundle (Buffer of a .zip containing
 * .shp/.shx/.dbf/.prj) or a raw multi-file payload (record of
 * filename -> Buffer). Returns a normalized WGS84 FeatureCollection.
 */

import AdmZip from 'adm-zip';
import { ValidationError, type FieldError } from '../../domain/errors/ValidationError.js';
import type { PerimeterFeatureCollection } from './parsePerimeterGeoJSON.js';

export type ShapefileInput = Buffer | Record<string, Buffer>;

const REQUIRED_SIDECARS = ['shp', 'shx', 'dbf', 'prj'] as const;

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
    // First occurrence wins; ignore duplicates in nested dirs
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

export async function parsePerimeterShapefile(
  input: ShapefileInput,
): Promise<PerimeterFeatureCollection> {
  const bundle = isBuffer(input) ? extractZip(input) : extractRecord(input);
  checkSidecars(bundle);
  // Subsequent slices: write to tmp dir + gdal parse + reproject + validate
  throw new Error('parsePerimeterShapefile: parsing not yet implemented');
}
