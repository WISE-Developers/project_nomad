/**
 * Turn a WISE weather stream into hourly observations (refs #294).
 *
 * The stream is stored as daily blocks of hours:
 *
 *   condition.dailyConditions.dailyConditions[].hourWeather.hours[]
 *
 * with temp, rh, ws, wd and precip on each hour.
 *
 * THREE THINGS THAT ARE QUIET WHEN WRONG:
 *
 * RH here is already a PERCENTAGE — 91.0, 88.0. A weather patch stores RH as a
 * fraction, and the ×100 belongs to the patch operand alone. Applying it on
 * this side too would be the same 100× error approached from the other end.
 *
 * A zero scalar carries no `value`. proto3 omits default values, so a dry hour
 * decodes as `precip: {hex: {value: "0x0.0000000000000p+0"}}` — the message is
 * present, the number is not. Message present with no value means zero;
 * message absent means the file never said, which is an error. Treating the
 * first as missing would drop every dry hour in the corpus.
 *
 * The stream's startTime carries NO offset — "2025-06-26T00:00:00" — while the
 * scenario's carries -06:00. The weather is in the project's local time and the
 * scenario is the only place the file declares what that is. Reading these as
 * UTC would shift every observation by six hours.
 */

import { numberOf, timeOf, type FgmjObject } from './fgmjValues.js';
import type { ResolvedScenario } from './resolveScenarios.js';

/** An hourly observation, before any fire-weather index has been computed. */
export interface WeatherObservation {
  date: Date;
  /** Celsius */
  temp: number;
  /** Percent, 0-100 — as the stream stores it */
  rh: number;
  /** km/h */
  ws: number;
  /** degrees, 0-360 */
  wd: number;
  /** mm */
  precip: number;
}

/**
 * The codes the stream starts from.
 *
 * Carried through rather than expanded into per-hour values: computing the
 * hourly FWI codes is a separate job, and inventing them here would be a silent
 * default of the worst kind.
 */
export interface StartingCodes {
  ffmc: number;
  dmc: number;
  dc: number;
  bui?: number;
  precipitation?: number;
}

export interface ExtractedWeatherStream {
  rows: WeatherObservation[];
  startingCodes: StartingCodes;
}

const OFFSET = /([+-]\d{2}:?\d{2}|Z)$/;
const OBSERVATIONS = ['temp', 'rh', 'ws', 'wd', 'precip'] as const;

function asArray(value: unknown): FgmjObject[] {
  return Array.isArray(value) ? (value as FgmjObject[]) : [];
}

/**
 * Read one observation.
 *
 * Distinguishes a zero from a gap: if the message exists but holds no number,
 * proto3 omitted a default and the value is zero. If the message itself is
 * missing, the file never recorded it and we stop.
 */
function observationOf(hour: FgmjObject, field: string, where: string): number {
  const message = hour[field];
  if (message === undefined || message === null) {
    throw new Error(
      `Weather stream ${where} has no ${field}. ` +
        'Refusing to import an hour the file never recorded.',
    );
  }
  const value = numberOf(message);
  // Message present, number absent — proto3 dropped a zero.
  return value ?? 0;
}

export function extractWeatherStream(scenario: ResolvedScenario): ExtractedWeatherStream {
  const condition = ((scenario.stream as FgmjObject).condition ?? {}) as FgmjObject;

  const days = asArray(
    (condition.dailyConditions as FgmjObject | undefined)?.dailyConditions,
  );
  if (days.length === 0) {
    throw new Error(
      `Weather stream "${scenario.streamName}" in scenario "${scenario.name}" has no ` +
        'daily blocks, so it carries no weather at all.',
    );
  }

  // The stream's start is a naked local time. The scenario declares the offset
  // the project is written in, and it is the only declaration in the file.
  const streamStart = timeOf(condition.startTime);
  if (!streamStart) {
    throw new Error(
      `Weather stream "${scenario.streamName}" has no start time, so its hours ` +
        'cannot be placed on a clock.',
    );
  }

  let startIso = streamStart;
  if (!OFFSET.test(streamStart)) {
    const scenarioOffset = OFFSET.exec(scenario.startTime)?.[0];
    if (!scenarioOffset) {
      throw new Error(
        `Weather stream "${scenario.streamName}" starts at ${streamStart} with no UTC ` +
          `offset, and scenario "${scenario.name}" declares none either. Refusing to ` +
          'guess a timezone for the weather.',
      );
    }
    startIso = `${streamStart}${scenarioOffset}`;
  }

  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) {
    throw new Error(
      `Weather stream "${scenario.streamName}" has an unreadable start time: ${startIso}.`,
    );
  }

  const rows: WeatherObservation[] = [];
  for (const [dayIndex, day] of days.entries()) {
    const hours = asArray((day.hourWeather as FgmjObject | undefined)?.hours);
    for (const [hourIndex, hour] of hours.entries()) {
      const where = `"${scenario.streamName}" day ${dayIndex + 1} hour ${hourIndex + 1}`;
      const observations = Object.fromEntries(
        OBSERVATIONS.map((field) => [field, observationOf(hour, field, where)]),
      ) as Record<(typeof OBSERVATIONS)[number], number>;

      rows.push({
        // The zone was resolved once above, where the offset is applied to the
        // stream's naked local start. This is epoch arithmetic from that point.
        date: new Date(startMs + rows.length * 3_600_000), // new-date-allowed: epoch arithmetic, no string parsed
        ...observations,
      });
    }
  }

  if (rows.length === 0) {
    throw new Error(
      `Weather stream "${scenario.streamName}" has daily blocks but no hours in any of them.`,
    );
  }

  const codes = (condition.startingCodes ?? {}) as FgmjObject;
  const ffmc = numberOf(codes.ffmc);
  const dmc = numberOf(codes.dmc);
  const dc = numberOf(codes.dc);
  if (ffmc === undefined || dmc === undefined || dc === undefined) {
    throw new Error(
      `Weather stream "${scenario.streamName}" is missing a starting code ` +
        '(ffmc, dmc or dc). These seed the whole run and cannot be defaulted.',
    );
  }

  return {
    rows,
    startingCodes: {
      ffmc,
      dmc,
      dc,
      ...(numberOf(codes.bui) !== undefined ? { bui: numberOf(codes.bui) } : {}),
      ...(numberOf(codes.precipitation) !== undefined
        ? { precipitation: numberOf(codes.precipitation) }
        : {}),
    },
  };
}
