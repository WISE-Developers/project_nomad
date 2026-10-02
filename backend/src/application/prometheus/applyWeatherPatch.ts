/**
 * Apply a Prometheus weather patch to a FireSTARR weather stream (refs #294).
 *
 * Patches are arithmetic over a time window, applied by altering the stream
 * before FireSTARR ever sees it — no engine support required.
 *
 * THE ×100, which is the highest-risk detail in the whole import:
 *
 *   fgmj stores RH as a FRACTION. WISE_JS_API's setValuePercent is
 *   `this.value = value / 100.0`, so `rh: {value: 0.05}` in the file means five
 *   percentage points. FireSTARR's CSV stores RH as a PERCENTAGE, and
 *   WeatherHourlyData.rh is documented 0-100.
 *
 * So RH — and only RH — is scaled by 100 on the way in. Temperature, wind speed
 * and precipitation are already in the units the CSV uses. Scaling all of them
 * is as wrong as scaling none: either way the run completes, looks entirely
 * plausible, and is out by two orders of magnitude.
 */

import { decodeOperation, GridType } from './weatherPatchOperations.js';
import type { WeatherHourlyData } from '../../infrastructure/firestarr/types.js';
import { numberOf, timeOf } from './fgmjValues.js';

type Obj = Record<string, unknown>;

/**
 * What applying a patch produced: the new stream, and anything the operator
 * needs told about it.
 *
 * Warnings are returned rather than logged. The import policy has several
 * notify-and-proceed cases — fuel patches, burning conditions, and this — and
 * the operator has to see them at the end of an import, not in a server log.
 * It also keeps this layer free of a logging dependency.
 */
export interface PatchResult {
  rows: WeatherHourlyData[];
  warnings: string[];
}

/** Relative humidity is a percentage of a whole; outside 0-100 it is not one. */
const RH_MIN = 0;
const RH_MAX = 100;

/** The five patchable variables, and where each lands on a weather row. */
const VARIABLES = [
  { field: 'temperature', column: 'temp', gridType: GridType.One, scale: 1 },
  // The one conversion. See the header.
  { field: 'rh', column: 'rh', gridType: GridType.One, scale: 100 },
  { field: 'precipitation', column: 'precip', gridType: GridType.One, scale: 1 },
  { field: 'windSpeed', column: 'ws', gridType: GridType.One, scale: 1 },
  // windDirection is the OTHER Operation enum — see weatherPatchOperations.
  { field: 'windDirection', column: 'wd', gridType: GridType.Two, scale: 1 },
] as const;

/** Minutes east of UTC carried by an ISO string, or undefined if it has none. */
function offsetMinutesOf(iso: string): number | undefined {
  if (/(Z|z)$/.test(iso)) return 0;
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  if (!m) return undefined;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Render an instant in the offset the patch was written in.
 *
 * `toISOString()` would report it in UTC, so a row the operator knows as 18:00
 * on the 26th in MDT comes back as the 27th — a different calendar day, in a
 * message whose whole purpose is to point at a specific row. Same class of
 * error as #402, and worth avoiding in the text as much as in the arithmetic.
 */
function formatInOffset(date: Date, offsetMinutes: number | undefined): string {
  if (offsetMinutes === undefined) return date.toISOString();
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${shifted.toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}


const SECONDS_PER_DAY = 86_400;

/**
 * Parse an `HSS.Times.WTimeSpan` into seconds from midnight.
 *
 * These are DURATIONS, not clock times, and the corpus writes them two ways:
 * 68 occurrences as "13:00:00:00" and 7 as "13:00:00" for the same thing. That
 * pairing settles the format — the leading field is HOURS, not days, and any
 * fourth field sits below seconds and is ignored.
 *
 * Absent means zero, i.e. midnight.
 */
function spanSeconds(value: unknown, patchName: string, which: string): number {
  if (value === undefined || value === null) return 0;

  const text = timeOf(value);
  if (text === undefined) return 0;

  const parts = text.split(':');
  if (parts.length < 3) {
    throw new Error(
      `Weather patch "${patchName}" has an unreadable ${which} "${text}". ` +
        'Expected h:mm:ss, optionally with a fourth sub-second field.',
    );
  }

  const [h, m, sec] = parts.slice(0, 3).map(Number);
  if (![h, m, sec].every(Number.isFinite)) {
    throw new Error(
      `Weather patch "${patchName}" has an unreadable ${which} "${text}". ` +
        'Expected h:mm:ss, optionally with a fourth sub-second field.',
    );
  }

  return h * 3600 + m * 60 + sec;
}

/** Seconds since local midnight, in the offset the patch window was written in. */
function localSecondsOfDay(date: Date, offsetMinutes: number): number {
  const shifted = date.getTime() + offsetMinutes * 60_000;
  const within = Math.floor(shifted / 1000) % SECONDS_PER_DAY;
  return within < 0 ? within + SECONDS_PER_DAY : within;
}

function applyOperation(
  current: number,
  operation: string,
  operand: number,
  what: string,
  patchName: string,
): number {
  switch (operation) {
    case 'Equal':
      return operand;
    case 'Plus':
      return current + operand;
    case 'Minus':
      return current - operand;
    case 'Multiply':
      return current * operand;
    case 'Divide':
      if (operand === 0) {
        throw new Error(
          `Weather patch "${patchName}" divides ${what} by zero. Refusing to import it.`,
        );
      }
      return current / operand;
    case 'Disable':
      // The variable's patch is switched off. Nothing to apply, and the value
      // the stream already carries is the right one to keep.
      return current;
    default:
      // decodeOperation should have rejected anything else already; this keeps
      // a new schema value from being silently ignored here.
      throw new Error(
        `Weather patch "${patchName}" uses operation "${operation}" on ${what}, ` +
          'which this importer does not implement.',
      );
  }
}

/**
 * Apply one patch to a stream, returning new rows.
 *
 * Rows outside the patch's window are passed through untouched. The input array
 * and its rows are not mutated.
 */
export function applyWeatherPatch(
  rows: WeatherHourlyData[],
  patch: Obj & { name: string },
): PatchResult {
  const filter = (patch.filter ?? {}) as Obj;

  const startTime = timeOf(filter.startTime);
  const endTime = timeOf(filter.endTime);
  if (!startTime || !endTime) {
    throw new Error(
      `Weather patch "${patch.name}" has no time window. ` +
        'A patch without a window cannot be applied to a stream.',
    );
  }

  const windowOffset = offsetMinutesOf(startTime);

  // The hours of each day the patch touches. 75 of the 78 occurrences in the
  // corpus have start == end, which is the whole cycle and therefore no
  // constraint at all; only 2 files carry a differing pair.
  const fromSeconds = spanSeconds(filter.startTimeOfDay, patch.name, 'startTimeOfDay');
  const toSeconds = spanSeconds(filter.endTimeOfDay, patch.name, 'endTimeOfDay');
  const constrainsHours = fromSeconds !== toSeconds;

  // A time-of-day window is meaningless without knowing which clock it is on.
  // Both differing files write their scenario times in UTC and keep the real
  // zone in timeZoneSettings.timezoneIndex (131084), a WISE-internal id this
  // importer cannot decode — so it refuses rather than measuring local hours
  // against UTC and silently patching the wrong ones.
  const hasExplicitOffset = /([+-])\d{2}:?\d{2}$/.test(startTime);
  if (constrainsHours && !hasExplicitOffset) {
    throw new Error(
      `Weather patch "${patch.name}" restricts itself to the hours ` +
        `${timeOf(filter.startTimeOfDay) ?? '00:00:00'} to ` +
        `${timeOf(filter.endTimeOfDay) ?? '00:00:00'} each day, but its window ` +
        `(${startTime}) carries no UTC offset, so those hours cannot be placed on a ` +
        'clock. The project timezone is recorded as a WISE timezoneIndex, which this ' +
        'importer cannot decode. Refusing rather than guessing a zone.',
    );
  }

  /** Is this row inside the daily window? Handles a window that wraps midnight. */
  const withinHours = (date: Date): boolean => {
    if (!constrainsHours) return true;
    const at = localSecondsOfDay(date, windowOffset ?? 0);
    return fromSeconds <= toSeconds
      ? at >= fromSeconds && at <= toSeconds
      : at >= fromSeconds || at <= toSeconds;
  };
  const from = new Date(startTime).getTime();
  const to = new Date(endTime).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error(
      `Weather patch "${patch.name}" has an unreadable window: ${startTime} to ${endTime}.`,
    );
  }

  // Resolve the operations once, so a patch naming an unknown one fails before
  // any row is touched rather than part-way through a stream.
  const changes = VARIABLES.flatMap((variable) => {
    const declared = filter[variable.field];
    if (!declared || typeof declared !== 'object') return [];

    // An absent operation means Equal, not a missing field. proto3 omits
    // zero-valued fields and Equal is 0 — in BOTH Operation enums, so this is
    // unambiguous. The real files write "Equal" explicitly (sage1's
    // precipitation, sage3's windDirection) and the decoder drops it, exactly
    // as it drops a precipitation of zero. decodeOperation stays strict about
    // genuinely unknown values; the proto3 default is resolved here instead.
    const raw = (declared as Obj).operation ?? 0;
    const operation = decodeOperation(raw as number | string, variable.gridType);

    const magnitude = numberOf((declared as Obj).value);
    if (magnitude === undefined) {
      throw new Error(
        `Weather patch "${patch.name}" gives ${variable.field} an operation but no value.`,
      );
    }

    return [{ ...variable, operation, operand: magnitude * variable.scale }];
  });

  if (changes.length === 0) {
    // A legal shape: a patch with a window and geometry but no weather
    // operation. Nothing to apply.
    return { rows: rows.map((row) => ({ ...row })), warnings: [] };
  }

  const warnings: string[] = [];

  const patched = rows.map((row) => {
    const at = row.date.getTime();
    if (at < from || at > to) return { ...row };
    if (!withinHours(row.date)) return { ...row };

    const next: Obj = { ...row };
    for (const change of changes) {
      const current = next[change.column];
      if (typeof current !== 'number') continue;
      const applied = applyOperation(
        current,
        change.operation,
        change.operand,
        change.field,
        patch.name,
      );

      // Clamp RH, and say so. A patch can legitimately push it past either end
      // — five points onto a row already at 98 — and 103 is not a humidity.
      // Clamping silently would be the silent default the import policy
      // forbids, so the operator is told which row and by how much.
      if (change.column === 'rh' && (applied < RH_MIN || applied > RH_MAX)) {
        const clamped = Math.min(RH_MAX, Math.max(RH_MIN, applied));
        warnings.push(
          `Weather patch "${patch.name}" put RH at ${applied} for ` +
            `${formatInOffset(row.date, windowOffset)}; clamped to ${clamped}.`,
        );
        next[change.column] = clamped;
        continue;
      }

      next[change.column] = applied;
    }
    return next as unknown as WeatherHourlyData;
  });

  return { rows: patched, warnings };
}
