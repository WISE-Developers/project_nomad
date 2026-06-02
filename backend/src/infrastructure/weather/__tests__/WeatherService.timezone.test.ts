/**
 * WeatherService — IANA timezone in CSV parsing.
 *
 * The FireSTARR weather CSV uses bare local-wallclock timestamps with no
 * offset (e.g. "2026-05-31 22:00:00"). Parsing such a string via `new Date()`
 * silently interprets it against the Node process timezone, which causes
 * day-slip when the simulation is in a different zone than the server.
 *
 * The parser must accept an explicit IANA timezone, parse bare timestamps
 * against that zone, and throw if no zone is supplied.
 *
 * Refs #273 (TZ double-adjust root cause) and #279 (SpotWx weather crash).
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { WeatherService } from '../WeatherService.js';

// Header that matches the FireSTARR-ready CSV format.
const HEADER = 'Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI';

function makeCsv(firstDate: string): string {
  // Single data row; values are arbitrary but plausible.
  return [
    HEADER,
    `0,${firstDate},0.0,20.0,40,10,180,90.0,30.0,200.0,5.0,40.0,15.0`,
  ].join('\n');
}

describe('WeatherService.resolveWeather — FireSTARR CSV timezone handling', () => {
  const service = new WeatherService();

  // Minimum config to drive the firestarr_csv branch
  const baseConfig = (csv: string, timezone: string) => ({
    source: 'firestarr_csv' as const,
    firestarrCsvContent: csv,
    timezone,
  });
  const location = { latitude: 53.27, longitude: -107.03 };
  const dateRange = { start: new Date(), end: new Date() };

  it('parses bare-timestamp CSV against the caller-supplied IANA timezone (America/Vancouver)', async () => {
    const csv = makeCsv('2026-05-31 22:00:00');
    const result = await service.resolveWeather(
      baseConfig(csv, 'America/Vancouver'),
      location,
      dateRange,
    );
    // 2026-05-31 22:00 in Vancouver (PDT, UTC-7) == 2026-06-01 05:00 UTC.
    const expectedUtc = DateTime.fromISO('2026-06-01T05:00:00.000Z', { zone: 'UTC' }).toMillis();
    expect(result[0].datetime.getTime()).toBe(expectedUtc);
  });

  it('parses the same bare timestamp differently when the timezone is America/Toronto', async () => {
    const csv = makeCsv('2026-05-31 22:00:00');
    const result = await service.resolveWeather(
      baseConfig(csv, 'America/Toronto'),
      location,
      dateRange,
    );
    // 2026-05-31 22:00 in Toronto (EDT, UTC-4) == 2026-06-01 02:00 UTC.
    const expectedUtc = DateTime.fromISO('2026-06-01T02:00:00.000Z', { zone: 'UTC' }).toMillis();
    expect(result[0].datetime.getTime()).toBe(expectedUtc);
  });

  it('throws a descriptive error when the timezone is missing', async () => {
    const csv = makeCsv('2026-05-31 22:00:00');
    await expect(
      service.resolveWeather(
        { source: 'firestarr_csv', firestarrCsvContent: csv },
        location,
        dateRange,
      ),
    ).rejects.toThrow(/timezone/i);
  });

  it('throws when the timezone is an empty string', async () => {
    const csv = makeCsv('2026-05-31 22:00:00');
    await expect(
      service.resolveWeather(baseConfig(csv, ''), location, dateRange),
    ).rejects.toThrow(/timezone/i);
  });

  it('throws when the timezone is not a valid IANA zone', async () => {
    const csv = makeCsv('2026-05-31 22:00:00');
    await expect(
      service.resolveWeather(baseConfig(csv, 'Not/A_Zone'), location, dateRange),
    ).rejects.toThrow(/timezone/i);
  });
});
