/**
 * Daily DMC/DC rollover — issue #352.
 *
 * DMC and DC are daily codes. #234 stopped them recomputing every hour; this
 * covers the follow-on, that the once-per-day update happens on the right day
 * and is driven by the right observation.
 *
 * Edmonton is UTC-6 in August, so UTC midnight falls at 18:00 local. Under the
 * old code a single local day was split there and updated twice, and the update
 * was driven by the evening observation instead of the afternoon one.
 */

import { describe, it, expect } from 'vitest';
import { WeatherService } from '../WeatherService.js';

const ZONE = 'America/Edmonton';
const HEADER = 'Date,PREC,TEMP,RH,WS,WD';

interface RowSpec {
  hour: number;
  temp?: number;
  rh?: number;
  prec?: number;
}

function csv(day: string, rows: RowSpec[]): string {
  return [
    HEADER,
    ...rows.map(
      ({ hour, temp = 20, rh = 45, prec = 0 }) =>
        `${day} ${String(hour).padStart(2, '0')}:00:00,${prec},${temp},${rh},10,180`,
    ),
  ].join('\n');
}

function multiDayCsv(days: Array<{ day: string; rows: RowSpec[] }>): string {
  return [
    HEADER,
    ...days.flatMap(({ day, rows }) =>
      rows.map(
        ({ hour, temp = 20, rh = 45, prec = 0 }) =>
          `${day} ${String(hour).padStart(2, '0')}:00:00,${prec},${temp},${rh},10,180`,
      ),
    ),
  ].join('\n');
}

const service = new WeatherService();

function resolve(content: string) {
  return service.resolveWeather(
    {
      source: 'raw_weather',
      rawWeatherContent: content,
      startingCodes: { ffmc: 85, dmc: 25, dc: 300 },
      latitude: 53.5,
      timezone: ZONE,
    },
    { latitude: 53.5, longitude: -113.5 },
    { start: new Date('2026-08-04T00:00:00Z'), end: new Date('2026-08-06T00:00:00Z') },
  );
}

const ALL_HOURS: RowSpec[] = Array.from({ length: 24 }, (_, hour) => ({ hour }));

describe('daily DMC/DC rollover', () => {
  it('updates ONCE across a full local day, not twice at the UTC boundary', async () => {
    // 18:00 and 19:00 local are the next UTC day but the same local day.
    const points = await resolve(csv('2026-08-04', ALL_HOURS));

    expect(new Set(points.map((p) => p.dmc)).size).toBe(1);
    expect(new Set(points.map((p) => p.dc)).size).toBe(1);
  });

  it('updates once per local day across two days', async () => {
    const points = await resolve(
      multiDayCsv([
        { day: '2026-08-04', rows: ALL_HOURS },
        { day: '2026-08-05', rows: ALL_HOURS },
      ]),
    );

    expect(new Set(points.map((p) => p.dmc)).size).toBe(2);
  });

  it('keeps every hour of a local day on that day’s codes', async () => {
    const points = await resolve(csv('2026-08-04', ALL_HOURS));
    const first = points[0];

    for (const point of points) {
      expect(point.dmc).toBe(first.dmc);
      expect(point.dc).toBe(first.dc);
    }
  });
});

describe('which observation drives the day', () => {
  it('is unaffected by evening conditions', async () => {
    // The old code drove DMC from the 18:00 row, which is cooler and damper
    // than the afternoon peak and biased the codes low.
    const mild = await resolve(csv('2026-08-04', ALL_HOURS));
    const hotEvening = await resolve(
      csv(
        '2026-08-04',
        ALL_HOURS.map((row) => (row.hour === 18 ? { ...row, temp: 38, rh: 12 } : row)),
      ),
    );

    expect(hotEvening[0].dmc).toBe(mild[0].dmc);
    expect(hotEvening[0].dc).toBe(mild[0].dc);
  });

  it('IS driven by conditions at local noon', async () => {
    const mild = await resolve(csv('2026-08-04', ALL_HOURS));
    const hotNoon = await resolve(
      csv(
        '2026-08-04',
        ALL_HOURS.map((row) => (row.hour === 12 ? { ...row, temp: 38, rh: 12 } : row)),
      ),
    );

    expect(hotNoon[0].dmc).toBeGreaterThan(mild[0].dmc);
  });

  it('uses the nearest observation when the day has no noon row', async () => {
    const rows: RowSpec[] = [{ hour: 8 }, { hour: 11, temp: 38, rh: 12 }, { hour: 16 }];
    const baseline: RowSpec[] = [{ hour: 8 }, { hour: 11 }, { hour: 16 }];

    const hot = await resolve(csv('2026-08-04', rows));
    const mild = await resolve(csv('2026-08-04', baseline));

    expect(hot[0].dmc).toBeGreaterThan(mild[0].dmc);
  });
});
