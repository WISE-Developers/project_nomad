/**
 * Turn a WISE weather stream into hourly observations (refs #294).
 *
 * The stream is stored as daily blocks of hours:
 *
 *   condition.dailyConditions.dailyConditions[].hourWeather.hours[]
 *
 * with temp, rh, ws, wd and precip on each hour.
 *
 * The weather is in ONE of two places. A Prometheus job carries it inline as
 * daily blocks of hours; a WISE job carries
 * `dataImportedFromFile: true` with a `filename` relative to the job file, and
 * no daily blocks at all. Running the importer over the 65 real .fgmj on disk
 * found the second form in 41 of them — two thirds of the corpus — so reading
 * only the inline shape refused most real files.
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

import fs from 'fs';
import path from 'path';
import { numberOf, timeOf, type FgmjObject } from './fgmjValues.js';
import { timezoneOf } from './importTimezone.js';
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


/**
 * Column aliases for a SpotWX forecast export.
 *
 * Real header: `HOURLY,HOUR,TEMP,RH,WD,WS,PRECIP` — the DATE is called HOURLY
 * and the hour is a SEPARATE column. Neither of Nomad's existing parsers
 * matches that: the raw parser needs an exact `date`, and the SpotWX parser's
 * aliases are datetime/date/time/valid. Hence reading it here.
 */
const COLUMNS = {
  date: ['hourly', 'date', 'datetime', 'time', 'valid'],
  hour: ['hour'],
  temp: ['temp', 'tmp', 'temperature'],
  rh: ['rh', 'humidity', 'relh'],
  ws: ['ws', 'wind', 'wspd', 'windspd'],
  wd: ['wd', 'wdir', 'winddir'],
  precip: ['precip', 'prec', 'apcp', 'precipitation'],
} as const;

function columnIndex(header: string[], aliases: readonly string[]): number {
  return header.findIndex((h) => aliases.includes(h));
}

/**
 * Read a weather stream out of the file the job points at.
 *
 * The path is relative to the .fgmj, so it is resolved against the job's own
 * directory. A missing file names the path it looked for: 7 of the 60 such
 * references in the corpus do not resolve, and "could not find X" is fixable
 * where "no weather" is not.
 */
function readExternalStream(
  condition: FgmjObject,
  scenario: ResolvedScenario,
  baseDir: string,
): WeatherObservation[] {
  const filename = condition.filename;
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error(
      `Weather stream "${scenario.streamName}" in scenario "${scenario.name}" has no ` +
        'daily blocks and names no file either, so it carries no weather at all.',
    );
  }

  const resolved = path.resolve(baseDir, filename);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Weather stream "${scenario.streamName}" points at "${filename}", which is not ` +
        `beside the job: looked for ${resolved}. A WISE job stores its weather in a ` +
        'sibling file, and the import cannot proceed without it.',
    );
  }

  const lines = fs
    .readFileSync(resolved, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error(`${resolved} has a header but no weather rows.`);
  }

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const index = Object.fromEntries(
    Object.entries(COLUMNS).map(([field, aliases]) => [field, columnIndex(header, aliases)]),
  ) as Record<keyof typeof COLUMNS, number>;

  for (const [field, idx] of Object.entries(index)) {
    if (field === 'hour') continue; // optional: a date column may carry the time
    if (idx === -1) {
      throw new Error(
        `${resolved} has no ${field} column. Found: ${header.join(', ')}. ` +
          `Expected one of: ${COLUMNS[field as keyof typeof COLUMNS].join(', ')}.`,
      );
    }
  }

  // The file's timestamps carry no offset; the scenario declares the project's.
  const offset = timezoneOf(scenario.startTime);

  return lines.slice(1).map((line, row) => {
    const parts = line.split(',').map((p) => p.trim());
    const at = (idx: number): number => {
      const value = Number(parts[idx]);
      if (!Number.isFinite(value)) {
        throw new Error(
          `${resolved} row ${row + 2} has an unreadable value "${parts[idx]}".`,
        );
      }
      return value;
    };

    const date = parts[index.date];
    const hour = index.hour === -1 ? undefined : parts[index.hour];
    // Date and hour are separate columns, so they are joined rather than parsed
    // apart. Reading the date alone would put every hour at midnight.
    const stamp = hour === undefined
      ? `${date}${offset}`
      : `${date}T${hour.padStart(2, '0')}:00:00${offset}`;
    const when = new Date(stamp); // new-date-allowed: offset appended explicitly above
    if (!Number.isFinite(when.getTime())) {
      throw new Error(`${resolved} row ${row + 2} has an unreadable time "${stamp}".`);
    }

    return {
      date: when,
      temp: at(index.temp),
      rh: at(index.rh),
      ws: at(index.ws),
      wd: at(index.wd),
      precip: at(index.precip),
    };
  });
}

/**
 * The codes the stream starts from. Identical for both storage forms: a WISE
 * job keeps its weather in a sibling file but its STARTING CODES in the job.
 */
function startingCodesOf(condition: FgmjObject, scenario: ResolvedScenario): StartingCodes {
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
    ffmc,
    dmc,
    dc,
    ...(numberOf(codes.bui) !== undefined ? { bui: numberOf(codes.bui) } : {}),
    ...(numberOf(codes.precipitation) !== undefined
      ? { precipitation: numberOf(codes.precipitation) }
      : {}),
  };
}

export function extractWeatherStream(
  scenario: ResolvedScenario,
  baseDir: string,
): ExtractedWeatherStream {
  const condition = ((scenario.stream as FgmjObject).condition ?? {}) as FgmjObject;

  const days = asArray(
    (condition.dailyConditions as FgmjObject | undefined)?.dailyConditions,
  );

  // A WISE job has no daily blocks; its weather is a sibling file.
  if (days.length === 0) {
    return {
      rows: readExternalStream(condition, scenario, baseDir),
      startingCodes: startingCodesOf(condition, scenario),
    };
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

  return { rows, startingCodes: startingCodesOf(condition, scenario) };
}
