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

type Obj = Record<string, unknown>;

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

/**
 * Unwrap a number that the schema may have nested.
 *
 * Values arrive as `{value: {value: 5, hex: "0x1.4p+2"}}` — a Math.Double
 * inside the variable message — so the number can sit one or two levels down.
 */
function numberOf(value: unknown, depth = 0): number | undefined {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && depth < 4) {
    return numberOf((value as Obj).value, depth + 1);
  }
  return undefined;
}

function timeOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const t = (value as Obj).time;
  return typeof t === 'string' ? t : undefined;
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
): WeatherHourlyData[] {
  const filter = (patch.filter ?? {}) as Obj;

  const startTime = timeOf(filter.startTime);
  const endTime = timeOf(filter.endTime);
  if (!startTime || !endTime) {
    throw new Error(
      `Weather patch "${patch.name}" has no time window. ` +
        'A patch without a window cannot be applied to a stream.',
    );
  }

  // Declared in the schema and seen in the wild as "13:00:00:00", constraining
  // the hours of each day the patch touches. No fixture carries one, so it is
  // refused rather than ignored: silently applying a patch to hours it was
  // meant to spare is exactly the kind of plausible-looking error this importer
  // exists to avoid.
  if (filter.startTimeOfDay !== undefined || filter.endTimeOfDay !== undefined) {
    throw new Error(
      `Weather patch "${patch.name}" carries a time-of-day window, which this ` +
        'importer does not yet apply. Refusing rather than applying it to the whole day.',
    );
  }

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

    const raw = (declared as Obj).operation;
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
    return rows.map((row) => ({ ...row }));
  }

  return rows.map((row) => {
    const at = row.date.getTime();
    if (at < from || at > to) return { ...row };

    const next: Obj = { ...row };
    for (const change of changes) {
      const current = next[change.column];
      if (typeof current !== 'number') continue;
      next[change.column] = applyOperation(
        current,
        change.operation,
        change.operand,
        change.field,
        patch.name,
      );
    }
    return next as unknown as WeatherHourlyData;
  });
}
