/**
 * Handing an imported scenario to the engine the way creating a model does
 * (refs #294).
 *
 * The engine's public entry is initialize(model, options: ExecutionOptions).
 * Everything FireSTARRParams holds, the engine derives itself from these
 * options — lat/lon from the ignition centroid, startDate/startTime from the
 * timeRange, the perimeter from the ignition type, the output offsets from the
 * duration. The one thing that does NOT travel that way is the .fgmj's own
 * starting codes, and they are the reason this module exists:
 *
 *   buildParams reads previousFFMC from the FIRST WEATHER ROW
 *   (FireSTARREngine.ts:653-656). The .fgmj stream is five observation columns
 *   with no fire-weather indices, so a naive conversion would hand the engine
 *   `undefined` for FFMC/DMC/DC and run a different fire while looking fine.
 *
 * Asserted against wise_job_LWF-184-2021 — a real WISE job — because a fixture
 * I wrote myself would only prove the importer agrees with me.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { planFgmjImport } from '../planFgmjImport.js';
import { toExecutionOptions } from '../toExecutionOptions.js';
import { GeometryType } from '../../../domain/entities/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (...p: string[]) => path.join(TEST_DATA, ...p);

const lwf184 = () => {
  const [plan] = planFgmjImport(fixture('wise_job_LWF-184-2021', 'job.fgmj'));
  if (!plan.runnable) {
    throw new Error(`fixture precondition failed: not runnable (${plan.blockers.join(', ')})`);
  }
  return plan;
};

describe('toExecutionOptions — the starting codes, which nothing else carries', () => {
  it('puts the file’s own starting codes on the first weather row', () => {
    const { options } = toExecutionOptions(lwf184());
    const [first] = options.weatherData!;
    expect(first.ffmc).toBe(37);
    expect(first.dmc).toBe(2);
    expect(first.dc).toBe(297);
  });

  it('does not invent indices for later rows that the file never recorded', () => {
    // The stream has no fire-weather indices. Carrying the day-one codes
    // forward onto every row would assert a drying trend the file never
    // described; FireSTARR recomputes them from the observations itself.
    const { options } = toExecutionOptions(lwf184());
    const [, second] = options.weatherData!;
    expect(second.ffmc).toBe(0);
    expect(second.dmc).toBe(0);
    expect(second.dc).toBe(0);
  });

  it('carries every observation row across, with its five real columns', () => {
    const plan = lwf184();
    const { options } = toExecutionOptions(plan);
    expect(options.weatherData).toHaveLength(241);
    expect(options.weatherData).toHaveLength(plan.weather.length);
    const [first] = options.weatherData!;
    expect(first.temperature).toBe(10.9);
    expect(first.humidity).toBe(98);
    expect(first.windSpeed).toBe(16);
    expect(first.windDirection).toBe(320);
    expect(first.precipitation).toBe(0);
    expect(first.datetime.toISOString()).toBe('2021-09-02T06:00:00.000Z');
  });
});

describe('toExecutionOptions — the window and the zone', () => {
  it('spans the scenario’s own start and end', () => {
    const { options } = toExecutionOptions(lwf184());
    expect(options.timeRange.start.toISOString()).toBe('2021-09-02T19:00:00.000Z');
    expect(options.timeRange.end.toISOString()).toBe('2021-09-05T19:00:00.000Z');
  });

  it('passes the offset the file carried, which Intl accepts', () => {
    const { options } = toExecutionOptions(lwf184());
    expect(options.timezone).toBe('-06:00');
    // The trap: Luxon takes "UTC-6" and Intl rejects it. Whatever we pass has
    // to survive Intl, because every engine time helper goes through it.
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: options.timezone })).not.toThrow();
  });
});

describe('toExecutionOptions — the ignition', () => {
  it('passes the single ignition through as its own geometry', () => {
    const { options } = toExecutionOptions(lwf184());
    expect(options.ignitionGeometry.type).toBe(GeometryType.Point);
    expect(options.ignitionGeometry.coordinates).toEqual([-112.2258, 55.678433]);
  });

  it('adds no notice of its own for a plain point ignition', () => {
    // Only POLYGON_IN currently carries an ignition divergence. A POINT that
    // was passed through untouched must not invent one.
    const { notices } = toExecutionOptions(lwf184());
    expect(notices.filter((n) => /ignition/i.test(n))).toEqual([]);
  });
});

describe('toExecutionOptions — telling the operator what was done', () => {
  it('says plainly that the hourly index columns were left at zero, and why', () => {
    // The operator is comparing an imported run against a historical one. A
    // silent zero-fill would look like recorded data.
    const { notices } = toExecutionOptions(lwf184());
    const weather = notices.find((n) => /index/i.test(n));
    expect(weather).toBeDefined();
    expect(weather).toContain('FFMC 37');
    expect(weather).toContain('DMC 2');
    expect(weather).toContain('DC 297');
    expect(weather).toMatch(/zero/i);
  });
});

describe('toExecutionOptions — refusals', () => {
  it('refuses a plan that is not runnable rather than filling in what is missing', () => {
    const plans = planFgmjImport(fixture('prometheus_job_sage1_patches_multiignition.fgmj'));
    const blocked = plans.find((p) => !p.runnable);
    expect(blocked).toBeDefined();
    expect(() => toExecutionOptions(blocked!)).toThrow(/not runnable|blocker/i);
  });
});
