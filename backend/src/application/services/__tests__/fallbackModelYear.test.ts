/**
 * #482 — the fallback model year must never be invented.
 *
 * `ModelResultsService` derives an arrival-time `startDate` from `output-config.json`'s
 * timeRange when it exists. When it does not, it fell back to reading the year off
 * `weather.csv` — and when that failed it substituted `new Date().getFullYear()`, so a
 * 2023 reconstruction was reported with a 2026 start date. The output looked correct and
 * was confidently wrong, and the bare `catch { /* use current year *\/ }` showed the
 * substitution was deliberate.
 *
 * Franco's ruling (2026-10-30), consistent with his #479 ruling that runs without a
 * recorded zone show no fuel vintage year rather than an assumed one: **when the year
 * cannot be determined there is no start date.** A year the regex actually finds IS
 * determined and is kept — the invented default is what goes.
 *
 * He also asked that this be recorded as provisional: it needs testing before we know it
 * is the final answer.
 *
 * These tests use real files in a real temp directory rather than a mocked `fs`, because
 * the thing under test is how a file on disk is read.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveFallbackModelYear } from '../fallbackModelYear.js';

describe('#482 — resolveFallbackModelYear', () => {
  let simDir: string;

  beforeEach(() => {
    simDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomad-482-'));
  });

  afterEach(() => {
    fs.rmSync(simDir, { recursive: true, force: true });
  });

  function writeWeather(contents: string): void {
    fs.writeFileSync(path.join(simDir, 'weather.csv'), contents, 'utf-8');
  }

  it('returns the year found on the second line', () => {
    writeWeather(
      'Scenario,DateTime,Temp\n' + 'S1,2023-06-19 13:00,21.5\n' + 'S1,2023-06-19 14:00,22.0\n'
    );

    expect(resolveFallbackModelYear(simDir)).toBe(2023);
  });

  it('returns a historical year rather than the current one — the defect this closes', () => {
    writeWeather('Scenario,DateTime\n' + 'S1,2011-05-14 09:00\n');

    const year = resolveFallbackModelYear(simDir);
    expect(year).toBe(2011);
    // Stated explicitly: the whole point is that it is NOT today.
    expect(year).not.toBe(new Date().getFullYear());
  });

  it('returns undefined when weather.csv is absent — no invented year', () => {
    expect(resolveFallbackModelYear(simDir)).toBeUndefined();
  });

  it('returns undefined when no date matches on the second line', () => {
    writeWeather('Scenario,DateTime,Temp\n' + 'S1,not-a-date,21.5\n');

    expect(resolveFallbackModelYear(simDir)).toBeUndefined();
  });

  it('returns undefined when the file has only a header', () => {
    writeWeather('Scenario,DateTime,Temp\n');

    expect(resolveFallbackModelYear(simDir)).toBeUndefined();
  });

  it('returns undefined when the file is empty', () => {
    writeWeather('');

    expect(resolveFallbackModelYear(simDir)).toBeUndefined();
  });

  it('returns undefined rather than throwing when the path is unreadable', () => {
    // A directory where the file is expected: readFileSync throws EISDIR.
    fs.mkdirSync(path.join(simDir, 'weather.csv'));

    expect(() => resolveFallbackModelYear(simDir)).not.toThrow();
    expect(resolveFallbackModelYear(simDir)).toBeUndefined();
  });
});
