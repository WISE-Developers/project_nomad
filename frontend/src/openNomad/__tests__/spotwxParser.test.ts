/**
 * Tests for SpotWX CSV → raw weather normalization (refs #244).
 *
 * Two supported SpotWX export formats are normalized into the same shape the
 * existing raw weather pipeline already accepts: columns
 *   Date, PREC, TEMP, RH, WS, WD
 * with Date as a combined "YYYY-MM-DD HH:MM:SS" timestamp.
 */

import { describe, it, expect } from 'vitest';
import { parseSpotwxCsv } from '../weather/spotwxParser.js';

describe('parseSpotwxCsv', () => {
  it('parses SpotWX basic format (DATETIME,DATE,TIME,TMP,RH,WS,WD,...) into raw weather shape', () => {
    const content =
      'DATETIME,DATE,TIME,TMP,RH,WS,WD,WG,APCP,CLOUD\n' +
      '2026/04/18 00:00,2026/04/18,00:00,-17.5,93,12,074,18,0.0,5\n' +
      '2026/04/18 01:00,2026/04/18,01:00,-18.5,98,11,088,12,0.3,6\n';

    const result = parseSpotwxCsv(content);

    expect(result.headers).toEqual(['Date', 'PREC', 'TEMP', 'RH', 'WS', 'WD']);
    expect(result.rows).toEqual([
      ['2026-04-18 00:00:00', '0.0', '-17.5', '93', '12', '074'],
      ['2026-04-18 01:00:00', '0.3', '-18.5', '98', '11', '088'],
    ]);
  });

  it('parses SpotWX prometheus format (HOURLY,HOUR,TEMP,RH,WD,WS,PRECIP) into raw weather shape', () => {
    const content =
      'HOURLY,HOUR,TEMP,RH,WD,WS,PRECIP\n' +
      '18/04/2026,0,-17.5,93,074,12,0.00\n' +
      '18/04/2026,1,-18.5,98,088,11,0.25\n';

    const result = parseSpotwxCsv(content);

    expect(result.headers).toEqual(['Date', 'PREC', 'TEMP', 'RH', 'WS', 'WD']);
    expect(result.rows).toEqual([
      ['2026-04-18 00:00:00', '0.00', '-17.5', '93', '12', '074'],
      ['2026-04-18 01:00:00', '0.25', '-18.5', '98', '11', '088'],
    ]);
  });

  it('throws on unrecognized SpotWX format', () => {
    const content = 'foo,bar,baz\n1,2,3\n';
    expect(() => parseSpotwxCsv(content)).toThrow(/Unrecognized SpotWX/i);
  });

  it('truncates rows at the first non-hourly gap and reports how many rows were dropped', () => {
    // SpotWX basic exports start hourly then switch to 3-hourly past day 5.
    // FireSTARR requires strictly hourly input, so we keep only the hourly
    // prefix and tell the user about the truncation (refs #244).
    const content =
      'DATETIME,DATE,TIME,TMP,RH,WS,WD,WG,APCP\n' +
      '2026/04/18 00:00,2026/04/18,00:00,10,80,5,180,0,0\n' +
      '2026/04/18 01:00,2026/04/18,01:00,11,80,5,180,0,0\n' +
      '2026/04/18 02:00,2026/04/18,02:00,12,80,5,180,0,0\n' +
      '2026/04/18 05:00,2026/04/18,05:00,14,80,5,180,0,0\n' +
      '2026/04/18 08:00,2026/04/18,08:00,16,80,5,180,0,0\n';

    const result = parseSpotwxCsv(content);

    expect(result.rows).toHaveLength(3);
    expect(result.rows[result.rows.length - 1]?.[0]).toBe('2026-04-18 02:00:00');
    expect(result.truncatedRowCount).toBe(2);
  });

  it('does not flag truncation when all rows are hourly', () => {
    const content =
      'DATETIME,DATE,TIME,TMP,RH,WS,WD,WG,APCP\n' +
      '2026/04/18 00:00,2026/04/18,00:00,10,80,5,180,0,0\n' +
      '2026/04/18 01:00,2026/04/18,01:00,11,80,5,180,0,0\n' +
      '2026/04/18 02:00,2026/04/18,02:00,12,80,5,180,0,0\n';

    const result = parseSpotwxCsv(content);

    expect(result.rows).toHaveLength(3);
    expect(result.truncatedRowCount).toBeUndefined();
  });
});

describe('normalizeSpotwxToRawWeather', () => {
  it('emits a raw-weather CSV text that the backend raw_weather path accepts', async () => {
    const { normalizeSpotwxToRawWeather } = await import('../weather/spotwxParser.js');
    const content =
      'DATETIME,DATE,TIME,TMP,RH,WS,WD,WG,APCP\n' +
      '2026/04/18 00:00,2026/04/18,00:00,-17.5,93,12,074,18,0.0\n' +
      '2026/04/18 01:00,2026/04/18,01:00,-18.5,98,11,088,12,0.3\n';

    const out = normalizeSpotwxToRawWeather(content);

    expect(out).toBe(
      'Date,PREC,TEMP,RH,WS,WD\n' +
        '2026-04-18 00:00:00,0.0,-17.5,93,12,074\n' +
        '2026-04-18 01:00:00,0.3,-18.5,98,11,088',
    );
  });
});
