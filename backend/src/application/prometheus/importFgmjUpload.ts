/**
 * Turn an uploaded Prometheus/WISE job into import plans (refs #294).
 *
 * PARSE ONLY. Nothing is persisted. The operator reviews the plan in the Model
 * Setup wizard and a model is created when they submit — not when they upload.
 * This follows perimetersImport rather than the ZIP model import, which writes
 * records straight away.
 *
 * It accepts a ZIP of the job FOLDER rather than only a lone .fgmj, because the
 * importer resolves external weather as a sibling path. That is exactly why six
 * corpus files fail with "points at Inputs/spotwx_forecast.txt, which is not
 * beside the job": LWF-184 keeps its weather in Inputs/, and most real WISE
 * jobs do. A bare .fgmj is still accepted — it simply refuses, with the missing
 * sibling named, when its weather is not inline.
 */

import AdmZip from 'adm-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ValidationError } from '../../domain/errors/index.js';
import { planFgmjImport, type ScenarioImportPlan } from './planFgmjImport.js';
import { toIgnitionGeometries } from './toIgnitionGeometry.js';
import { toWeatherConfig } from './toWeatherConfig.js';

/**
 * The response contract, shared with the frontend's ImportedScenarioPlan.
 *
 * Exported and asserted in tests because a field renamed on one side only
 * would fail silently — the wizard would prefill `undefined` and nobody would
 * be told.
 */
export const WIRE_FIELDS = [
  'scenarioName',
  'startTime',
  'endTime',
  'durationHours',
  'timezone',
  'latitude',
  'longitude',
  'startingCodes',
  'ignitions',
  'rawWeatherContent',
  'weatherRowCount',
  'appliedPatches',
  'skippedFuelPatches',
  'skippedWindPatches',
  'polygonPatches',
  'blockers',
  'blockerDetail',
  'warnings',
  'divergences',
  'runnable',
] as const;

export interface ImportedScenarioPlan {
  scenarioName: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  timezone: string;
  latitude?: number;
  longitude?: number;
  startingCodes: { ffmc: number; dmc: number; dc: number; precipitation?: number };
  ignitions: Array<{
    name: string;
    geometry: { type: string; coordinates: unknown };
    divergence?: string;
  }>;
  rawWeatherContent?: string;
  weatherRowCount: number;
  appliedPatches: string[];
  skippedFuelPatches: string[];
  skippedWindPatches: string[];
  polygonPatches: string[];
  blockers: string[];
  blockerDetail: string[];
  warnings: string[];
  divergences: string[];
  runnable: boolean;
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b]); // "PK"

function isZip(buffer: Buffer, name: string): boolean {
  return buffer.subarray(0, 2).equals(ZIP_MAGIC) || name.toLowerCase().endsWith('.zip');
}

/**
 * Extract into `dir`, refusing any entry that would land outside it.
 *
 * AdmZip will happily honour an entry named `../escaped` — zip slip. An upload
 * endpoint must never write outside its own temp directory, so each resolved
 * path is checked against the root before anything is written.
 */
function extractSafely(zip: AdmZip, dir: string): void {
  const root = path.resolve(dir) + path.sep;
  for (const entry of zip.getEntries()) {
    const target = path.resolve(dir, entry.entryName);
    if (!target.startsWith(root)) {
      // Zip slip. adm-zip normalises "../" in addFile but NOT on read, so a
      // crafted archive arrives with the traversal intact.
      throw ValidationError.forField(
        'file',
        `entry "${entry.entryName}" resolves outside the extraction directory. ` +
          'Refusing the whole archive rather than skipping the entry.',
      );
    }
    if (entry.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }
}

/** Every .fgmj under `dir`, as paths relative to it. */
function findFgmj(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      // macOS archive sidecars are not job files.
      else if (entry.name.toLowerCase().endsWith('.fgmj') && !entry.name.startsWith('._')) {
        found.push(path.relative(dir, full));
      }
    }
  };
  walk(dir);
  return found.sort();
}

/** One plan as the wizard prefill consumes it. */
function toWire(plan: ScenarioImportPlan): ImportedScenarioPlan {
  // Geometry and weather are only derivable once the plan is runnable; a
  // blocked plan still reports its blockers so the operator learns why.
  const ignitions = plan.runnable
    ? toIgnitionGeometries(plan).map((g) => ({
        name: g.name,
        geometry: g.geometry.toGeoJSON(),
        divergence: g.divergence,
      }))
    : [];

  return {
    scenarioName: plan.scenarioName,
    startTime: plan.startTime,
    endTime: plan.endTime,
    durationHours: plan.durationHours,
    timezone: plan.timezone,
    latitude: plan.latitude,
    longitude: plan.longitude,
    startingCodes: plan.startingCodes,
    ignitions,
    rawWeatherContent: plan.runnable ? toWeatherConfig(plan).rawWeatherContent : undefined,
    weatherRowCount: plan.weather.length,
    appliedPatches: plan.appliedPatches,
    skippedFuelPatches: plan.skippedFuelPatches,
    skippedWindPatches: plan.skippedWindPatches,
    polygonPatches: plan.polygonPatches,
    blockers: plan.blockers,
    blockerDetail: plan.blockerDetail,
    warnings: plan.warnings,
    divergences: plan.divergences,
    runnable: plan.runnable,
  };
}

export function importFgmjUpload(buffer: Buffer, originalName: string): ImportedScenarioPlan[] {
  const name = originalName.toLowerCase();
  const zipped = isZip(buffer, originalName);
  if (!zipped && !name.endsWith('.fgmj')) {
    throw ValidationError.forField(
      'file',
      'must be a .fgmj job or a .zip of the job folder (the folder matters: ' +
        'a WISE job keeps its weather in a sibling Inputs/ directory)',
    );
  }

  // A temp directory, because the importer reads from disk and resolves
  // siblings relative to the job file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-fgmj-'));
  try {
    let jobPath: string;

    if (zipped) {
      extractSafely(new AdmZip(buffer), dir);
      const found = findFgmj(dir);
      if (found.length === 0) {
        throw ValidationError.forField(
          'file',
          'contains no .fgmj job file. A Prometheus or WISE job folder has one.',
        );
      }
      if (found.length > 1) {
        throw ValidationError.forField(
          'file',
          `contains more than one .fgmj (${found.length}): ${found.join(', ')}. ` +
            'Upload one job at a time rather than letting this pick for you.',
        );
      }
      jobPath = path.join(dir, found[0]);
    } else {
      jobPath = path.join(dir, path.basename(originalName));
      fs.writeFileSync(jobPath, buffer);
    }

    return planFgmjImport(jobPath).map(toWire);
  } finally {
    // Always, including on a refusal — an upload must not accumulate temp
    // directories on the server.
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
