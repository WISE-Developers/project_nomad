/**
 * Resolve each scenario's references and time window (refs #294).
 *
 * The fgmj declares ignitions, stations, streams and filters once, and each
 * scenario points at them BY NAME — despite the fields being called
 * `fireIndex`, `weatherIndex` and `filterIndex`. So this builds a name → object
 * table and every lookup becomes a failure point. That is deliberate: an
 * unresolved reference means the file describes a run we cannot reproduce, and
 * importing it anyway would produce a model that looks right and burns
 * differently.
 *
 * Duration comes from the scenario window and nothing else. In the sample file
 * all three scenarios share one weather stream and run 24, 24 and 72 hours, so
 * any duration taken from the weather would be wrong for two of them.
 * tools/extract-wise-jobs.ts sets `durationHours = weatherRows.length`; that is
 * correct for its own purpose and must not be carried over here.
 */

import type { FgmjProject } from './loadFgmjProject.js';
import { nameOf, timeOf } from './fgmjValues.js';

type Obj = Record<string, unknown>;

/** polyWeather is a weather patch; polyReplace and replace are fuel patches. */
export type FilterKind = 'weather' | 'fuel';

/** A filter a scenario names, unwrapped from its oneof and tagged with its kind. */
export type ResolvedFilter = Record<string, unknown> & {
  name: string;
  kind: FilterKind;
  /** True when the patch covers the whole landscape rather than a polygon. */
  landscape: boolean;
};

export interface ResolvedScenario {
  name: string;
  ignitionNames: string[];
  ignitions: Obj[];
  stationName: string;
  station: Obj;
  streamName: string;
  stream: Obj;
  weatherFilterNames: string[];
  /**
   * Every filter this scenario names, in order, tagged with its kind. Named
   * `weatherFilters` historically; it carries fuel patches too, which the
   * planner notifies about and skips.
   */
  weatherFilters: ResolvedFilter[];
  /** ISO 8601 with the offset the file carried, not normalised to UTC. */
  startTime: string;
  endTime: string;
  durationHours: number;
}

function asArray(value: unknown): Obj[] {
  return Array.isArray(value) ? (value as Obj[]) : [];
}

/**
 * Filters arrive wrapped in the schema's `oneof` — `{ polyWeather: {...} }` —
 * so the name lives one level down under a key that varies by kind.
 *
 * The oneof key says what kind of filter this is, and the kinds are handled
 * very differently:
 *
 *   polyWeather   a weather patch — applied to the stream
 *   polyReplace   a fuel patch over a polygon — notified and skipped
 *   replace       a fuel patch over the landscape — notified and skipped
 *
 * Fuels come from Nomad, so fuel patches are never applied. Treating one as a
 * weather patch is not a near miss: it has no time window, no variables, and
 * nothing to arithmetic.
 */
const FILTER_KINDS: Record<string, FilterKind> = {
  polyWeather: 'weather',
  polyReplace: 'fuel',
  replace: 'fuel',
};

function unwrapFilter(entry: Obj): ResolvedFilter | undefined {
  for (const [key, value] of Object.entries(entry)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const inner = value as Obj;
      const name = nameOf(inner);
      if (name === undefined) continue;

      const kind = FILTER_KINDS[key];
      if (!kind) {
        throw new Error(
          `Filter "${name}" is of unknown kind "${key}". This importer handles ` +
            `${Object.keys(FILTER_KINDS).join(', ')}. Refusing rather than ignoring it.`,
        );
      }

      // Normalise the name onto the returned object so callers get one shape,
      // whether the schema wrapped it or not. `landscape` distinguishes a patch
      // covering the whole landscape from one bounded by a polygon.
      return { ...inner, name, kind, landscape: inner.landscape === true };
    }
  }
  return undefined;
}

function must<T>(found: T | undefined, what: string, name: string, scenario: string): T {
  if (found === undefined) {
    throw new Error(
      `Scenario "${scenario}" references ${what} "${name}", which this .fgmj does not declare. ` +
        'Refusing to import a scenario whose inputs cannot be resolved.',
    );
  }
  return found;
}

export function resolveScenarios(project: FgmjProject): ResolvedScenario[] {
  // name -> object, built once for the whole file
  const ignitionsByName = new Map<string, Obj>();
  for (const ignition of project.ignitions) {
    const n = nameOf(ignition);
    if (n) ignitionsByName.set(n, ignition);
  }

  const stationsByName = new Map<string, Obj>();
  const streamsByName = new Map<string, Obj>();
  for (const station of project.stations) {
    const n = nameOf(station);
    if (n) stationsByName.set(n, station);
    // Streams are nested inside the station's own settings message.
    const inner = (station.station ?? {}) as Obj;
    for (const stream of asArray(inner.streams)) {
      const sn = nameOf(stream);
      if (sn) streamsByName.set(sn, stream);
    }
  }

  const filtersByName = new Map<string, ResolvedFilter>();
  for (const filter of project.weatherFilters) {
    const inner = unwrapFilter(filter);
    if (inner) filtersByName.set(inner.name, inner);
  }

  return project.scenarios.map((scenario) => {
    const entry = scenario.raw;
    const where = scenario.name;

    const ignitionNames = asArray(entry.fireIndex)
      .map(nameOf)
      .filter((n): n is string => n !== undefined);
    const ignitions = ignitionNames.map((n) =>
      must(ignitionsByName.get(n), 'ignition', n, where),
    );

    const weather = asArray(entry.weatherIndex)[0];
    if (!weather) {
      throw new Error(
        `Scenario "${where}" names no weather stream. ` +
          'A scenario without weather cannot produce a run.',
      );
    }
    const stationName = must(
      nameOf((weather.stationIndex ?? {}) as Obj),
      'a weather station',
      '(unnamed)',
      where,
    );
    const streamName = must(
      nameOf((weather.streamIndex ?? {}) as Obj),
      'a weather stream',
      '(unnamed)',
      where,
    );
    const station = must(stationsByName.get(stationName), 'weather station', stationName, where);
    const stream = must(streamsByName.get(streamName), 'weather stream', streamName, where);

    const weatherFilterNames = asArray(entry.filterIndex)
      .map(nameOf)
      .filter((n): n is string => n !== undefined);
    const weatherFilters = weatherFilterNames.map((n) =>
      must(filtersByName.get(n), 'weather filter', n, where),
    );

    const inner = (entry.scenario ?? {}) as Obj;
    const startTime = must(timeOf(inner.startTime), 'a start time', '(absent)', where);
    const endTime = must(timeOf(inner.endTime), 'an end time', '(absent)', where);

    const spanMs = new Date(endTime).getTime() - new Date(startTime).getTime();
    if (!Number.isFinite(spanMs) || spanMs <= 0) {
      throw new Error(
        `Scenario "${where}" has a non-positive window: ${startTime} to ${endTime}.`,
      );
    }
    const durationHours = spanMs / 3_600_000;

    return {
      name: where,
      ignitionNames,
      ignitions,
      stationName,
      station,
      streamName,
      stream,
      weatherFilterNames,
      weatherFilters,
      startTime,
      endTime,
      durationHours,
    };
  });
}
