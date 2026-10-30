/**
 * Reads the date a model was simulated FOR — not when it executed (refs #319).
 *
 * The results view shows which fuel vintage produced a result, and fuel is
 * selected by the modelled year. Using execution time would report a 2023
 * reconstruction as 2026 fuel: the same defect as validating fuel coverage
 * against new Date().getFullYear().
 *
 * Sources, in order of authority:
 *   1. timeRange.start — output-config.json (local runs) or model.json (imports)
 *   2. undefined — deliberately NOT today. An unknown year stays unknown; a
 *      confident wrong year is worse than an absent one.
 *
 * THERE IS NO weather.csv FALLBACK, AND THERE CANNOT BE ONE HERE (#479).
 *
 * One was documented and implemented, and it could never return a date. It read
 * column 0 of weather.csv, which is `Scenario`, not the date — 69 of 69 weather
 * files in the sample run directories begin with `Scenario` and none with a
 * date, so it parsed "0" every time. Its tests passed only because their
 * fixture invented a `datetime,temp` header that no FireSTARR file has.
 *
 * Fixing the column would not have been enough, and this is the part that makes
 * the fallback impossible rather than merely broken. The Date column carries a
 * BARE local timestamp, and by our own timezone contract (#354) it is local time
 * in the zone the model declares, never UTC. This function is given only a
 * directory — it has no zone, and the declared zone lives in output-config.json
 * or model.json, the very files whose absence is what would trigger a fallback.
 * So at the moment one would run, the information needed to read the timestamp
 * correctly is by definition unavailable.
 *
 * Franco's call, 2026-10-28: leave these runs without a fuel vintage year rather
 * than assume the server's home zone to recover one. Assuming would be wrong
 * only for runs starting on Dec 31 or Jan 1, since only the YEAR is displayed —
 * but that is the same bargain this function already refuses in source 2, and
 * refusing it consistently is worth more than the recovered rows.
 *
 * If a start date is ever needed for such runs, the zone must be recorded at
 * execution time; it cannot be recovered afterwards from the weather file.
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { parseIsoToDate } from '../../shared/dateParsing.js';

const CONFIG_FILES = ['output-config.json', 'model.json'];

/**
 * Parses a stored datetime; undefined when it isn't a real date.
 * Uses the shared strict parser rather than bare `new Date(...)` — a loosely
 * parsed date here would silently mislabel which fuel vintage a result used.
 */
function parseDate(value: unknown, context: string): Date | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  try {
    return parseIsoToDate(value, context);
  } catch {
    return undefined;
  }
}

async function fromConfig(simDir: string): Promise<Date | undefined> {
  for (const fileName of CONFIG_FILES) {
    const filePath = join(simDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }
    try {
      const raw = JSON.parse(await readFile(filePath, 'utf8')) as {
        timeRange?: { start?: string };
      };
      const parsed = parseDate(raw.timeRange?.start, `modelStartDate ${fileName} timeRange.start`);
      if (parsed) {
        return parsed;
      }
    } catch {
      // Malformed config is not fatal — fall through to the next source.
      continue;
    }
  }
  return undefined;
}

/**
 * The model's simulation start date, or undefined when nothing records it.
 *
 * THIS IS NOW THE LEGACY SOURCE (#482 half 1). The time range is a property of
 * the model (`FireModel.timeRange`, migration 009) and callers that have the
 * model should prefer it. This function remains for the runs that predate that
 * column, whose range exists only as a side effect in the sim directory.
 */
export async function readModelStartDate(simDir: string): Promise<Date | undefined> {
  return fromConfig(simDir);
}

/**
 * The full range recorded in the sim directory, or undefined.
 *
 * Same files and same authority as `readModelStartDate` — kept beside it so the
 * knowledge of WHICH files record a range lives in one module rather than being
 * re-derived by each consumer. The arrival-time branch of ModelResultsService
 * used to inline its own `JSON.parse(readFileSync(...))` against a path it had
 * just established might not exist; the throw was swallowed by an enclosing
 * catch and the entire arrival output silently disappeared.
 *
 * Returns undefined unless BOTH ends parse. Half a range is not a range.
 */
export async function readModelTimeRange(
  simDir: string,
): Promise<{ start: Date; end: Date } | undefined> {
  for (const fileName of CONFIG_FILES) {
    const filePath = join(simDir, fileName);
    if (!existsSync(filePath)) {
      continue;
    }
    try {
      const raw = JSON.parse(await readFile(filePath, 'utf8')) as {
        timeRange?: { start?: string; end?: string };
      };
      const start = parseDate(raw.timeRange?.start, `readModelTimeRange ${fileName} start`);
      const end = parseDate(raw.timeRange?.end, `readModelTimeRange ${fileName} end`);
      if (start && end) {
        return { start, end };
      }
    } catch {
      // Malformed config is not fatal — fall through to the next source.
      continue;
    }
  }
  return undefined;
}
