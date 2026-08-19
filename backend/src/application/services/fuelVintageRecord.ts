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

export interface FuelVintageRecord {
  /** The year the model was run FOR. */
  requestedYear: number;
  /** The vintage directory actually used — "2024", "default". */
  vintage: string;
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

    return {
      requestedYear: parsed.requestedYear,
      vintage: parsed.vintage,
      matchedRequestedYear: parsed.matchedRequestedYear === true,
      usedFallback: parsed.usedFallback === true,
      gridPath: parsed.gridPath,
      recordedAt: parsed.recordedAt,
    };
  } catch {
    return undefined;
  }
}
