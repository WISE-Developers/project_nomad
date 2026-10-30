/**
 * Derive a model's year from `weather.csv` — or report that it cannot be derived (#482).
 *
 * Used only as a fallback: `ModelResultsService` takes the arrival-time `startDate` from
 * `output-config.json`'s `timeRange` whenever that exists. This path is for the runs that
 * have neither `output-config.json` nor `model.json` timeRange.
 *
 * **It returns `undefined` rather than guessing.** The previous implementation initialised
 * the year to `new Date().getFullYear()` and only overwrote it on a successful match, so a
 * 2023 reconstruction with no readable weather file was reported as starting in the current
 * year — feeding `offsetDay` and the arrival raster's time coordinate. The output looked
 * correct and was confidently wrong. **A silent default is a lie.**
 *
 * Franco's ruling, 2026-10-30, applying his #479 ruling consistently: when the year cannot
 * be determined there is no start date. A year this function actually finds IS determined
 * and is kept; the invented default is what goes.
 *
 * **Recorded as provisional at his instruction** — "this might not be the final answer, it
 * needs testing and then we will know." What needs testing is the consequence downstream,
 * not this rule: the arrival-time layer uses `startDate` as the absolute baseline for
 * dropping pre-ignition bins, so a run with no derivable year loses that baseline rather
 * than getting a wrong one.
 *
 * Extracted from `ModelResultsService` so the rule can be tested at all. It was previously
 * inline in a method that also reads the sim directory, builds outputs and calls the
 * gateway, and it had no test coverage of any kind.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Matches an ISO-style date anywhere on the line, so column position does not matter. */
const DATE_PATTERN = /(\d{4})-\d{2}-\d{2}/;

/**
 * The model year read from the first data row of `simDir/weather.csv`.
 *
 * @returns the four-digit year, or `undefined` when it cannot be determined — no file, no
 *          data row, no date on that row, or the file cannot be read. **Never a
 *          substituted value.**
 */
export function resolveFallbackModelYear(simDir: string): number | undefined {
  try {
    const weatherPath = path.join(simDir, 'weather.csv');
    if (!fs.existsSync(weatherPath)) return undefined;

    // Line 0 is the header; line 1 is the first data row.
    const firstLines = fs.readFileSync(weatherPath, 'utf-8').split('\n').slice(0, 2);
    const dateMatch = firstLines[1]?.match(DATE_PATTERN);
    if (!dateMatch) return undefined;

    return parseInt(dateMatch[1], 10);
  } catch {
    // Unreadable is indistinguishable from absent for this purpose, and both mean
    // "undetermined". It must not mean "today".
    return undefined;
  }
}

export default resolveFallbackModelYear;
