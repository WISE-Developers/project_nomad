/**
 * Writes the weather file for condition 3's last piece. IT DOES NOT RUN THE ENGINE.
 *
 * WHAT THIS SCRIPT ACTUALLY DOES: builds 72 hours of hourly weather, validates it
 * against the FireSTARR contract, and writes `weather.csv` into `NOMAD_PROOF_DIR`. That
 * is all. It starts no container and invokes no engine.
 *
 * THIS HEADER USED TO CLAIM OTHERWISE — "this runs the engine against that raster root
 * and reads what it says" — and it never did (#563). Corrected 2026-11-26, because a
 * header describing work the body does not do is worse than no header: it reads as
 * evidence that the end-to-end run exists, and the one thing #563 must not claim is
 * that a real fire has run on a WCS-sourced grid.
 *
 * SO THE ENGINE INVOCATION IS STILL TO BE WRITTEN, and when it is, this is the signal to
 * assert. FireSTARR's own failure for a raster root it cannot use is "Could not find an
 * environment to use for (lat, lon)" — that exact message is why `--raster-root` was
 * added in #520. The question is whether the engine FOUND an environment in the
 * reprojected grid, NOT whether it exited 0: a run that exits non-zero after finding its
 * environment has consumed the grid, and a run that exits 0 without one has not.
 *
 * The weather is written by the production writer AND checked by the production
 * validator, because a CSV the engine rejects looks exactly like a fuel problem. This
 * file used the writer without the validator and produced precisely that confusion — a
 * `FATAL: map::at` that was read as a fuel fault for days. See the note on START.
 */

import { join } from 'node:path';
import { writeWeatherCSV } from '../src/infrastructure/firestarr/WeatherCSVWriter.js';
import { validateFireStarrContract } from '../src/infrastructure/firestarr/weatherContract.js';

const WORK = process.env.NOMAD_PROOF_DIR;
if (!WORK) throw new Error('NOMAD_PROOF_DIR must be set');

const TIMEZONE = 'America/Edmonton';

/**
 * NOON, LOCAL, ON THE FIRST DAY — and that is the whole of #563's step 3 (`map::at`).
 *
 * This was `2026-07-01T19:00:00Z`, which in `America/Edmonton` is **13:00 MDT**. The
 * first local day therefore ran 13:00–23:00 and carried NO hour-12 record. FireSTARR
 * builds its daily fire weather from noon records only — `if (12 == t.tm_hour)` in its
 * own source — so that day never got a daily entry and the later lookup threw
 * `FATAL: map::at`, about ten seconds in, after loading the fuel table and locating the
 * ignition. Which is exactly what it looks like when the FUEL is wrong, and is why the
 * harness failure was never attributable to the WCS source: the same harness failed on
 * the INSTALLED dataset too.
 *
 * `18:00:00Z` is 12:00 MDT. Verified against the production contract by sweeping the
 * start hour: 10:00 and 11:00 local fail because the ignition precedes the first noon
 * record, 13:00 and 14:00 fail because day one has no noon record at all, and **12:00
 * is the only hour of the five that passes.** Both failure modes bracket it, so this is
 * a measured value and not a plausible one.
 *
 * DO NOT "ROUND" THIS. An hour either way reintroduces one of the two failures, and
 * neither says anything about fuel when it does.
 */
const START = new Date('2026-07-01T18:00:00Z');

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

  // THE CHECK PRODUCTION RUNS, RUN HERE TOO (#563 step 3).
  //
  // This is the structural half of the fix, and it matters more than the constant above.
  // This file's own header says "a hand-made CSV that the engine rejects would look
  // exactly like a fuel problem" — and then it wrote one anyway, because it used the
  // production WRITER without the production VALIDATOR. A run died at `map::at` and the
  // first suspicion fell on the WCS grid.
  //
  // Refusing BEFORE the file is written, so the failure names the weather instead of
  // arriving ten seconds into an engine run as a map lookup.
  const contract = validateFireStarrContract(
    weather.map((w) => ({ datetime: w.date })),
    weather[0].date,
    TIMEZONE,
    weather[weather.length - 1].date,
  );
  if (!contract.valid) {
    throw new Error(
      'the generated weather breaks the FireSTARR contract, so this harness would have ' +
        'produced a `map::at` failure that reads like a fuel problem:\n  - ' +
        contract.issues.join('\n  - '),
    );
  }

  const path = join(WORK, 'weather.csv');
  await writeWeatherCSV(path, weather, { scenarioId: 0, timezone: TIMEZONE });
  process.stdout.write(`${path}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
