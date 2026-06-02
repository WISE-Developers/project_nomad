/**
 * Integration test — Neal's fixture round-trip.
 *
 * Reproduces the shape of one of Neal McLoughlin's failing demo runs
 * (NE BC, lat 56.79, lon -121.63, 2026-06-01, weather first row in BC local
 * the prior calendar day) and asserts the post-fix invariant:
 *
 *   Input bare-timestamp CSV row in `America/Vancouver`
 *     → WeatherService.resolveWeather with `timezone: 'America/Vancouver'`
 *     → WeatherCSVWriter with the same IANA zone
 *     → output bare-timestamp matches the input exactly (no day-shift).
 *
 * Pre-fix, this round-trip dropped a day for a server-TZ ≠ sim-TZ user,
 * producing the `FATAL: map::at` cluster (#273 / #279 / #280 / #284).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { WeatherService } from '../WeatherService.js';
import { writeWeatherCSV } from '../../firestarr/WeatherCSVWriter.js';
import type { WeatherHourlyData } from '../../firestarr/types.js';

const HEADER = 'Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI';

// Generate a 24-hour window of plausible weather rows in BC local starting at
// 2026-05-31 22:00 (the same starting moment as Neal's failing run).
function nealBcFixtureCsv(): string {
  const lines = [HEADER];
  const startEpochMs = Date.UTC(2026, 4, 31, 22 + 7, 0, 0); // 22:00 PDT (UTC-7) → 05:00 UTC next day
  for (let h = 0; h < 24; h++) {
    const epoch = startEpochMs + h * 3_600_000;
    const d = new Date(epoch); // new-date-allowed: epoch math
    const Y = d.getUTCFullYear();
    const M = String(d.getUTCMonth() + 1).padStart(2, '0');
    const D = String(d.getUTCDate()).padStart(2, '0');
    const utcHr = d.getUTCHours();
    // Re-render in BC local (UTC-7) by subtracting 7h, manually:
    const localEpoch = epoch - 7 * 3_600_000;
    const ld = new Date(localEpoch); // new-date-allowed: epoch math
    const ly = ld.getUTCFullYear();
    const lm = String(ld.getUTCMonth() + 1).padStart(2, '0');
    const ldd = String(ld.getUTCDate()).padStart(2, '0');
    const lh = String(ld.getUTCHours()).padStart(2, '0');
    lines.push(`0,${ly}-${lm}-${ldd} ${lh}:00:00,0.0,15.0,40,10,180,90.0,30.0,200.0,5.0,40.0,15.0`);
    // (Y/M/D/utcHr above only needed to keep the loop self-consistent.)
    void Y; void M; void D; void utcHr;
  }
  return lines.join('\n');
}

describe('Integration — Neal NE-BC fixture: bare-timestamp round-trip preserves the day', () => {
  let tmp: string;
  let outCsv: string;
  const service = new WeatherService();
  const TIMEZONE = 'America/Vancouver';
  const location = { latitude: 56.78566, longitude: -121.62683 };
  const dateRange = { start: new Date(), end: new Date() }; // new-date-allowed: stub placeholder

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'neal-fixture-'));
    outCsv = join(tmp, 'weather.csv');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('round-trips first row "2026-05-31 22:00:00" through Vancouver TZ unchanged', async () => {
    const input = nealBcFixtureCsv();

    // 1. Parse via the fixed service.
    const points = await service.resolveWeather(
      {
        source: 'firestarr_csv',
        firestarrCsvContent: input,
        timezone: TIMEZONE,
      },
      location,
      dateRange,
    );

    expect(points.length).toBe(24);

    // The first point's epoch should map to 22:00 PDT == 05:00 UTC next day.
    expect(points[0].datetime.toISOString()).toBe('2026-06-01T05:00:00.000Z');

    // 2. Convert and write back via WeatherCSVWriter using the same IANA zone.
    const hourly: WeatherHourlyData[] = points.map((p) => ({
      date: p.datetime,
      temp: p.temperature,
      rh: p.humidity,
      ws: p.windSpeed,
      wd: p.windDirection,
      precip: p.precipitation,
      ffmc: p.ffmc,
      dmc: p.dmc,
      dc: p.dc,
      isi: p.isi ?? 0,
      bui: p.bui ?? 0,
      fwi: p.fwi ?? 0,
    }));
    await writeWeatherCSV(outCsv, hourly, { timezone: TIMEZONE });

    // 3. Inspect the first written row.
    const written = await readFile(outCsv, 'utf-8');
    const firstRow = written.split('\n')[1];
    const writtenFirstDate = firstRow.split(',')[1];

    // The bare-timestamp string must round-trip exactly — pre-fix the server
    // TZ would shift this by hours and drop the calendar day.
    expect(writtenFirstDate).toBe('2026-05-31 22:00:00');
  });

  it('throws clearly if a caller forgets the IANA timezone', async () => {
    const input = nealBcFixtureCsv();
    await expect(
      service.resolveWeather(
        { source: 'firestarr_csv', firestarrCsvContent: input },
        location,
        dateRange,
      ),
    ).rejects.toThrow(/timezone/i);
  });
});
