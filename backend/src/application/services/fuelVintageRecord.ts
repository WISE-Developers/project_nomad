/**
 * Reading the fuel vintage a completed run recorded — issue #331.
 *
 * The results view used to call resolveForYear() when the page was viewed, so
 * installing a fuel year later retroactively rewrote what past runs claimed to
 * have used. A finished run is a record of what happened.
 *
 * Nothing here infers or falls back. A run with no record reads as "not
 * recorded", which is the truth, rather than today's answer to a question that
 * was asked long ago.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import { fuelVintageForDatasetYear } from '../../domain/value-objects/fuelYears.js';

export interface FuelVintageRecord {
  /** The year the model was run FOR. */
  requestedYear: number;
  /**
   * The dataset directory actually used, exactly as recorded — "2024",
   * "default". Kept verbatim: it is evidence of what happened, and rewriting it
   * is the failure #331 closed.
   */
  vintage: string;
  /**
   * The recorded directory as a year, when it is one. Undefined for "default".
   */
  datasetYear?: number;
  /**
   * The season the fuel data describes: datasetYear - 1 (#431). Undefined when
   * the directory carries no year — never inferred.
   */
  fuelVintage?: number;
  /** Whether that vintage matched the requested year. */
  matchedRequestedYear: boolean;
  /** Whether a default dataset stood in for a missing year. */
  usedFallback: boolean;
  /** The exact grid file used, for tracing. */
  gridPath?: string;
  /** When the run wrote this down. */
  recordedAt?: string;
}

/** Returns undefined when nothing was recorded, or the record is unusable. */
export async function readFuelVintage(simDir: string): Promise<FuelVintageRecord | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(simDir, 'fuel-vintage.json'), 'utf-8');
  } catch {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<FuelVintageRecord>;

    // A record without a vintage answers nothing; treat it as absent rather
    // than surfacing a half-answer that reads as fact.
    if (typeof parsed.vintage !== 'string' || typeof parsed.requestedYear !== 'number') {
      return undefined;
    }

    // "default" is a legitimate recorded value and is not a year. Number() on
    // it gives NaN, which the domain rule rejects rather than coercing.
    const asYear = Number(parsed.vintage);
    const datasetYear = Number.isInteger(asYear) ? asYear : undefined;

    return {
      requestedYear: parsed.requestedYear,
      vintage: parsed.vintage,
      datasetYear,
      fuelVintage: fuelVintageForDatasetYear(datasetYear),
      matchedRequestedYear: parsed.matchedRequestedYear === true,
      usedFallback: parsed.usedFallback === true,
      gridPath: parsed.gridPath,
      recordedAt: parsed.recordedAt,
    };
  } catch {
    return undefined;
  }
}
