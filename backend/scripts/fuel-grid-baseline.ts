/**
 * Condition 4's measuring instrument (plan D8, Step 0).
 *
 * THE QUESTION THIS ANSWERS, AND NOTHING ELSE: with `NOMAD_FUEL_SOURCE` unset, does
 * the existing local fuel path still select the same grid, with the same bytes, for a
 * fixed model? Run it before the first #282 wiring commit to capture a baseline, and
 * again after each wiring step to compare.
 *
 * IT CALLS THE PRODUCTION SELECTOR. `FireSTARRInputGenerator.findFuelGridForCoordinates`
 * is the code a real run uses; a reimplementation of its proximity sort and extent check
 * would typecheck, agree with itself forever, and measure a proposition one step beside
 * the one that matters. The import below is the whole point of this file.
 *
 * WHAT IS DELIBERATELY NOT CLAIMED: FireSTARR is handed `--raster-root`, a DIRECTORY, and
 * picks its own grid internally (see FireSTARREngine.buildCommand, `--raster-root`). So
 * there is no single "fuel grid handed to the engine" file in the local path, and this
 * instrument does not pretend otherwise. What it captures is the grid OUR code resolves
 * for the ignition — which is the artefact the WCS source replaces, and therefore the
 * right subject for condition 4.
 *
 * One run = one reading. Two readings are taken by two separate processes, because a
 * value copied inside one process proves only that assignment works.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { FireSTARRInputGenerator } from '../src/infrastructure/firestarr/FireSTARRInputGenerator.js';

/** The fixed model. Hay River, NWT — the same ignition the timezone suite uses. */
const MODEL = {
  model_id: 'baseline-hay-river-2026',
  latitude: 60.82,
  longitude: -115.7,
  modelYear: 2026,
} as const;

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function main(): Promise<void> {
  const gridRoot = process.env.NOMAD_BASELINE_GRID_ROOT;
  if (!gridRoot) {
    throw new Error('NOMAD_BASELINE_GRID_ROOT must name the dataset grid root to measure');
  }
  if (!existsSync(gridRoot)) {
    throw new Error(`NOMAD_BASELINE_GRID_ROOT does not exist: ${gridRoot}`);
  }

  // The flag must be ABSENT, not merely falsy. `NOMAD_FUEL_SOURCE=local` is a different
  // state from unset once the resolver has a production caller, and condition 4 is
  // written about unset. Refusing here keeps the baseline from being captured under a
  // condition it does not describe.
  if ('NOMAD_FUEL_SOURCE' in process.env) {
    throw new Error(
      `NOMAD_FUEL_SOURCE is present (${JSON.stringify(process.env.NOMAD_FUEL_SOURCE)}); ` +
        'condition 4 is about the flag being UNSET. Unset it and re-run.'
    );
  }

  const generator = new FireSTARRInputGenerator({ gridRoot });
  const selected = await generator.findFuelGridForCoordinates(
    MODEL.latitude,
    MODEL.longitude,
    MODEL.modelYear
  );

  if (!selected) {
    // A null here is a real answer about the dataset, not a broken instrument — and it
    // means condition 4 has no subject for this model. Say so loudly rather than
    // emitting a record with an empty hash that a later comparison would call equal.
    throw new Error(
      `findFuelGridForCoordinates returned undefined for ${MODEL.latitude},${MODEL.longitude} ` +
        `year ${MODEL.modelYear} under ${gridRoot}. Condition 4 cannot be measured for this ` +
        'model: there is no selected grid to hash.'
    );
  }

  // Which directory the selection came from is part of the baseline: year-specific and
  // `default` are different resolution outcomes that can yield the same bytes today and
  // diverge the moment a year directory is installed.
  const yearDir = `${gridRoot}/${MODEL.modelYear}`;
  const resolvedFrom = selected.startsWith(`${yearDir}/`) ? 'year-specific' : 'default-fallback';

  // The candidate set the selector had to choose FROM. A wiring change that alters which
  // file wins is caught by the hash; one that alters what was on offer is caught here.
  const dir = selected.slice(0, selected.lastIndexOf('/'));
  const candidates = (await readdir(dir))
    .filter((n) => n.startsWith('fuel_') && n.endsWith('.tif'))
    .sort();

  const record = {
    captured_at: new Date().toISOString(),
    model_id: MODEL.model_id,
    inputs: {
      latitude: MODEL.latitude,
      longitude: MODEL.longitude,
      modelYear: MODEL.modelYear,
      gridRoot,
    },
    nomad_fuel_source: 'unset (asserted absent from process.env)',
    selected_grid: selected,
    resolved_from: resolvedFrom,
    hash: await sha256(selected),
    size_bytes: (await stat(selected)).size,
    candidate_count: candidates.length,
    candidates_sha256: createHash('sha256').update(candidates.join('\n')).digest('hex'),
  };

  // The production selector logs to stdout via console.log, so stdout is a shared
  // channel and parsing it would mean separating a record from log noise. The record
  // gets its own file; stdout stays the generator's.
  const out = process.env.NOMAD_BASELINE_OUT;
  const json = `${JSON.stringify(record, null, 2)}\n`;
  if (out) {
    await writeFile(out, json);
    process.stdout.write(`baseline record written to ${out}\n`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
