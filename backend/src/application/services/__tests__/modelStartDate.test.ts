/**
 * readModelStartDate — the simulation's start date, for results (refs #319)
 *
 * The results view needs the year the fire was MODELLED for, not when the run
 * executed. Using execution time would show a 2023 reconstruction as 2026 fuel
 * — the same class of bug as validating coverage against new Date().
 *
 * Sources, in order of authority:
 *   1. timeRange.start in output-config.json (local runs) or model.json (imports)
 *   2. the first datetime in weather.csv — what FireSTARR actually starts from
 *   3. undefined — NOT today's year. An unknown year must stay unknown.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { readModelStartDate } from '../modelStartDate.js';

describe('readModelStartDate', () => {
  let simDir: string;

  beforeEach(async () => {
    simDir = await mkdtemp(join(tmpdir(), 'model-start-date-test-'));
  });

  afterEach(async () => {
    await rm(simDir, { recursive: true, force: true });
  });

  const writeOutputConfig = (start: string) =>
    writeFile(
      join(simDir, 'output-config.json'),
      JSON.stringify({ timeRange: { start, end: start } }),
      'utf8'
    );

  const writeWeather = (rows: string[]) =>
    writeFile(join(simDir, 'weather.csv'), ['datetime,temp', ...rows].join('\n'), 'utf8');

  it('prefers timeRange.start from output-config.json', async () => {
    await writeOutputConfig('2023-06-19T12:00:00.000Z');

    const result = await readModelStartDate(simDir);

    expect(result?.getUTCFullYear()).toBe(2023);
  });

  it('reads timeRange.start from model.json for imported models', async () => {
    await writeFile(
      join(simDir, 'model.json'),
      JSON.stringify({ timeRange: { start: '2019-08-01T00:00:00.000Z', end: '2019-08-05T00:00:00.000Z' } }),
      'utf8'
    );

    const result = await readModelStartDate(simDir);

    expect(result?.getUTCFullYear()).toBe(2019);
  });

  it('falls back to the first weather.csv datetime when no config carries a range', async () => {
    await writeWeather(['2021-07-04T18:00:00.000Z,22', '2021-07-04T19:00:00.000Z,23']);

    const result = await readModelStartDate(simDir);

    expect(result?.getUTCFullYear()).toBe(2021);
  });

  it('returns undefined when nothing records the modelled date', async () => {
    const result = await readModelStartDate(simDir);

    expect(result).toBeUndefined();
  });

  it('never substitutes the current year', async () => {
    await writeWeather(['not-a-date,22']);

    const result = await readModelStartDate(simDir);

    expect(result).toBeUndefined();
  });

  it('ignores malformed config and still uses weather.csv', async () => {
    await writeFile(join(simDir, 'output-config.json'), '{ this is not json', 'utf8');
    await writeWeather(['2020-05-10T12:00:00.000Z,15']);

    const result = await readModelStartDate(simDir);

    expect(result?.getUTCFullYear()).toBe(2020);
  });
});
