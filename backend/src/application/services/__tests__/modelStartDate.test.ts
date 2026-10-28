/**
 * readModelStartDate — the simulation's start date, for results (refs #319)
 *
 * The results view needs the year the fire was MODELLED for, not when the run
 * executed. Using execution time would show a 2023 reconstruction as 2026 fuel
 * — the same class of bug as validating coverage against new Date().
 *
 * Sources, in order of authority:
 *   1. timeRange.start in output-config.json (local runs) or model.json (imports)
 *   2. undefined — there is no weather.csv fallback; see #479 and the module doc
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

  /**
   * A REAL FireSTARR weather.csv, not an invented one.
   *
   * The previous fixture wrote `datetime,temp` with ISO-Z values, which is a
   * shape no FireSTARR file has. It was wrong in both of the ways that matter:
   * the real header puts `Scenario` in column 0 and the date in column 1, and
   * the real Date column carries a BARE local timestamp with no zone. Measured
   * across the sample run directories: 69 of 69 weather files begin with
   * `Scenario`, none with a date.
   *
   * Writing the real shape is what makes the fallback's two faults visible.
   */
  const FIRESTARR_HEADER = 'Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI';

  const weatherRow = (timestamp: string) =>
    `0,${timestamp},0,8.2,73,5,20,83.5,53.7,568.9,2.21,86.84,9.46`;

  const writeWeather = (timestamps: string[]) =>
    writeFile(
      join(simDir, 'weather.csv'),
      [FIRESTARR_HEADER, ...timestamps.map(weatherRow)].join('\n'),
      'utf8'
    );

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

  it('does NOT read a date out of weather.csv, however well-formed the file is', async () => {
    // A perfectly valid FireSTARR weather file. There is deliberately no
    // fallback to it (#479): its Date column is a bare local timestamp and this
    // function has no zone to read it in, so a recovered date would be a guess.
    await writeWeather(['2021-07-04 18:00:00', '2021-07-04 19:00:00']);

    const result = await readModelStartDate(simDir);

    expect(result).toBeUndefined();
  });

  it('returns undefined when nothing records the modelled date', async () => {
    const result = await readModelStartDate(simDir);

    expect(result).toBeUndefined();
  });

  it('never substitutes the current year', async () => {
    await writeWeather(['not-a-date']);

    const result = await readModelStartDate(simDir);

    expect(result).toBeUndefined();
  });

  it('falls through malformed config to undefined, not to weather.csv', async () => {
    await writeFile(join(simDir, 'output-config.json'), '{ this is not json', 'utf8');
    await writeWeather(['2020-05-10 12:00:00']);

    const result = await readModelStartDate(simDir);

    expect(result).toBeUndefined();
  });

  it('still reads a good config when a weather file sits beside it', async () => {
    // The control for the two tests above: they assert an absence, and an
    // absence is only meaningful if this same setup CAN produce a date. Without
    // this, deleting the whole function would pass them both.
    await writeOutputConfig('2023-06-19T12:00:00.000Z');
    await writeWeather(['2021-07-04 18:00:00']);

    const result = await readModelStartDate(simDir);

    expect(result?.getUTCFullYear()).toBe(2023);
  });
});
