/**
 * Slash dates in an external WISE weather file (refs #294).
 *
 * `job_20230601200839430/Inputs/weather.txt` is a real WISE job whose weather
 * begins:
 *
 *     HOURLY,HOUR,TEMP,RH,WD,WS,PRECIP
 *     01/06/2023,0,3.58,53,249,2,0.34
 *
 * `new Date('01/06/2023T00:00:00+00:00')` is unreadable, so the whole job was
 * refused.
 *
 * DD/MM vs MM/DD cannot be settled from that file alone — its first field is
 * 1, 2, 3 and its second is always 6. Franco settled it: "logic would dictate
 * we dont fight fire in january". Months 1-3 would put a hourly fire-weather
 * stream in January to March; days 1-3 of June is a fire. **Day first.**
 *
 * It is NOT inferred per-file, and NOT silently flipped when a value looks
 * wrong. A second field above 12 cannot be a month, which would mean the file
 * is not day-first after all — and since reading it the wrong way puts the
 * fire in the wrong month on the wrong fuels, that refuses rather than guesses.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { isoDateOf } from '../extractWeatherStream.js';
import { planFgmjImport } from '../planFgmjImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (...p: string[]) => path.join(TEST_DATA, ...p);

describe('isoDateOf', () => {
  it('reads a real row from the WISE job as day-first', () => {
    expect(isoDateOf('01/06/2023')).toBe('2023-06-01');
  });

  it('reads the rest of that file’s days the same way', () => {
    expect(isoDateOf('02/06/2023')).toBe('2023-06-02');
    expect(isoDateOf('03/06/2023')).toBe('2023-06-03');
  });

  it('keeps a day past the 12th as a day, where month-first would be impossible', () => {
    expect(isoDateOf('19/06/2023')).toBe('2023-06-19');
    expect(isoDateOf('31/08/2021')).toBe('2021-08-31');
  });

  it('passes an ISO date straight through', () => {
    expect(isoDateOf('2023-06-01')).toBe('2023-06-01');
  });

  it('pads single-digit day and month', () => {
    expect(isoDateOf('1/6/2023')).toBe('2023-06-01');
  });

  it('refuses a second field that cannot be a month, rather than flipping it', () => {
    // 06/19/2023 would be June 19 read month-first. Accepting it would mean
    // silently switching convention per row.
    expect(() => isoDateOf('06/19/2023')).toThrow(/month/i);
  });

  it('refuses a day that cannot be a day', () => {
    expect(() => isoDateOf('32/06/2023')).toThrow(/day/i);
  });

  it('refuses a shape it does not recognise rather than returning something', () => {
    expect(() => isoDateOf('June 1 2023')).toThrow(/unrecognised|unreadable/i);
    expect(() => isoDateOf('01-06-2023')).toThrow(/unrecognised|unreadable/i);
  });
});

describe('a refused date names where it came from', () => {
  /**
   * isoDateOf knows the date is wrong but not which file or row it came from.
   * A refusal an operator cannot locate is most of the way to useless — the
   * same reason the unreadable-value and unreadable-time errors already carry
   * `${resolved} row N`.
   *
   * Driven through planFgmjImport against a COPY of the real LWF-184 job with
   * one weather row corrupted, rather than through a seam invented for the
   * test. Its own dates are ISO, so the corruption is the only slash date.
   */
  it('reports the file and the row number, not just the bad value', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fgmj-date-'));
    const job = path.join(tmp, 'wise_job_LWF-184-2021');
    fs.cpSync(fixture('wise_job_LWF-184-2021'), job, { recursive: true });

    const weather = path.join(job, 'Inputs', 'spotwx_forecast.txt');
    const lines = fs.readFileSync(weather, 'utf8').split('\n');
    // Line index 2 is the SECOND data row, so row 3 counting the header.
    lines[2] = lines[2].replace(/^[^,]+/, '06/19/2021');
    fs.writeFileSync(weather, lines.join('\n'));

    let message = '';
    try {
      planFgmjImport(path.join(job, 'job.fgmj'));
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).toContain('spotwx_forecast.txt');
    expect(message).toMatch(/row 3/);
    expect(message).toMatch(/month/i);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
