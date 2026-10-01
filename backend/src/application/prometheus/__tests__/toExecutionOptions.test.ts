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

describe('toExecutionOptions — weather goes through Nomad\u2019s own CFFDRS stepping', () => {
  /**
   * NOT pre-resolved weatherData. buildParams has two branches: pre-resolved
   * `weatherData` is used verbatim, while `weatherConfig` is resolved through
   * WeatherService, which steps the starting codes forward with the real
   * `cffdrs` library.
   *
   * The .fgmj records observations and STARTING codes only — no hourly indices.
   * Taking the weatherData branch means inventing values for the FFMC/DMC/DC
   * columns, and a zero in a CFFDRS column is a signal to FireSTARR NOT TO BURN
   * that hour (Franco, 2026-10-01). Zero-filling them produced a fire that
   * ignited and never spread.
   *
   * So the config branch is the only correct one, and it is also the one the
   * importer already had: toWeatherConfig.
   */
  it('hands over a raw_weather config, not pre-resolved weather rows', () => {
    const { options } = toExecutionOptions(lwf184());
    expect(options.weatherConfig).toBeDefined();
    expect(options.weatherConfig!.source).toBe('raw_weather');
    expect(options.weatherData).toBeUndefined();
  });

  it('passes the file\u2019s starting codes for CFFDRS to step forward', () => {
    const { options } = toExecutionOptions(lwf184());
    expect(options.weatherConfig!.startingCodes).toEqual({ ffmc: 37, dmc: 2, dc: 297 });
  });

  it('emits no fire-weather columns at all, rather than inventing them', () => {
    const { options } = toExecutionOptions(lwf184());
    const [header] = options.weatherConfig!.rawWeatherContent!.split('\n');
    expect(header).toBe('Date,PREC,TEMP,RH,WS,WD');
    expect(header).not.toMatch(/FFMC|DMC|DC|ISI|BUI|FWI/);
  });

  it('carries every observation row across', () => {
    const plan = lwf184();
    const { options } = toExecutionOptions(plan);
    const lines = options.weatherConfig!.rawWeatherContent!.split('\n');
    expect(lines).toHaveLength(plan.weather.length + 1); // + header
    expect(lines).toHaveLength(242);
  });

  it('writes local wall-clock times with no offset, the offset travelling separately', () => {
    const { options } = toExecutionOptions(lwf184());
    const [, firstRow] = options.weatherConfig!.rawWeatherContent!.split('\n');
    // 2021-09-02T06:00:00Z at -06:00 is midnight local.
    expect(firstRow).toBe('2021-09-02 00:00,0,10.9,98,16,320');
    expect(options.weatherConfig!.timezone).toBe('-06:00');
  });

  it('needs no zero-fill notice, because nothing is zero-filled', () => {
    const { notices } = toExecutionOptions(lwf184());
    expect(notices.filter((n) => /zero/i.test(n))).toEqual([]);
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

describe('toExecutionOptions — refusals', () => {
  it('refuses a plan whose weather resolved to nothing', () => {
    // toWeatherConfig owns this validation. toExecutionOptions carried a
    // duplicate guard with nothing asserting it; a mutation removing the
    // duplicate survived even after this test was added, which is what
    // revealed the duplication. One guard, one test.
    const plan = { ...lwf184(), weather: [] };
    expect(() => toExecutionOptions(plan)).toThrow(/no weather rows to hand over/i);
  });

  it('refuses a plan that is not runnable rather than filling in what is missing', () => {
    const plans = planFgmjImport(fixture('prometheus_job_sage1_patches_multiignition.fgmj'));
    const blocked = plans.find((p) => !p.runnable);
    expect(blocked).toBeDefined();
    expect(() => toExecutionOptions(blocked!)).toThrow(/not runnable|blocker/i);
  });
});
