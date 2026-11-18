/**
 * Condition 3's last piece: a real fire, on the WCS-sourced grid.
 *
 * Everything else in Step 3 proves the GRID is right and that the engine would be
 * pointed at it. This runs the engine against that raster root and reads what it says.
 *
 * THE SIGNAL THAT MATTERS IS NOT "EXIT 0". FireSTARR's own failure for a raster root it
 * cannot use is "Could not find an environment to use for (lat, lon)" — that exact
 * message is why `--raster-root` was added in #520. So the question this asks is whether
 * the engine FOUND an environment in our reprojected grid. A run that gets past that has
 * consumed the grid; a run that does not has been handed a file it cannot read, whatever
 * every other artefact says.
 *
 * The weather file is written by the production writer, not hand-rolled, because a
 * hand-made CSV that the engine rejects would look exactly like a fuel problem.
 */

import { join } from 'node:path';
import { writeWeatherCSV } from '../src/infrastructure/firestarr/WeatherCSVWriter.js';

const WORK = process.env.NOMAD_PROOF_DIR;
if (!WORK) throw new Error('NOMAD_PROOF_DIR must be set');

const START = new Date('2026-07-01T19:00:00Z');

async function main(): Promise<void> {
  // The real WeatherHourlyData shape. Hourly CFFDRS codes on EVERY row: daily-only
  // codes in the hourly slot parse to NaN and segfault the engine.
  const weather = Array.from({ length: 72 }, (_, hour) => ({
    date: new Date(START.getTime() + hour * 3600_000),
    temp: 24 - (hour % 12) * 0.4,
    rh: 32 + (hour % 12),
    ws: 14,
    wd: 230,
    precip: 0,
    ffmc: 90,
    dmc: 40,
    dc: 300,
    isi: 12,
    bui: 55,
    fwi: 25,
  }));

  const path = join(WORK, 'weather.csv');
  await writeWeatherCSV(path, weather, { scenarioId: 0, timezone: 'America/Edmonton' });
  process.stdout.write(`${path}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
