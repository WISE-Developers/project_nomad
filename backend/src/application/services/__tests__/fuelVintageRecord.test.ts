/**
 * Reading the recorded fuel vintage — issue #331.
 *
 * Results must read what was written when the model ran, never re-resolve.
 * Where nothing was recorded — every run that predates #331 — the answer is
 * "not recorded", not a guess made today.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { readFuelVintage } from '../fuelVintageRecord.js';

describe('readFuelVintage', () => {
  let simDir: string;

  beforeEach(async () => {
    simDir = await mkdtemp(join(tmpdir(), 'fuel-vintage-read-'));
  });

  afterEach(async () => {
    await rm(simDir, { recursive: true, force: true });
  });

  async function write(contents: unknown): Promise<void> {
    await writeFile(join(simDir, 'fuel-vintage.json'), JSON.stringify(contents), 'utf-8');
  }

  it('returns what the run recorded', async () => {
    await write({
      requestedYear: 2024,
      vintage: '2024',
      matchedRequestedYear: true,
      usedFallback: false,
      gridPath: '/data/generated/grid/100m/2024/fuel_11_0.tif',
      recordedAt: '2026-08-19T12:00:00.000Z',
    });

    const record = await readFuelVintage(simDir);

    expect(record?.vintage).toBe('2024');
    expect(record?.requestedYear).toBe(2024);
    expect(record?.usedFallback).toBe(false);
  });

  it('preserves the admission that a default dataset was substituted', async () => {
    await write({
      requestedYear: 2024,
      vintage: 'default',
      matchedRequestedYear: false,
      usedFallback: true,
      gridPath: '/data/generated/grid/100m/default/fuel_11_0.tif',
      recordedAt: '2026-08-19T12:00:00.000Z',
    });

    const record = await readFuelVintage(simDir);
    expect(record?.usedFallback).toBe(true);
    expect(record?.vintage).toBe('default');
  });

  it('returns undefined for a run that predates the recording', async () => {
    // Must NOT infer one. Installing 2024 tomorrow cannot change what a run
    // from last year used.
    expect(await readFuelVintage(simDir)).toBeUndefined();
  });

  it('returns undefined rather than throwing on an unreadable record', async () => {
    await writeFile(join(simDir, 'fuel-vintage.json'), 'not json at all', 'utf-8');
    expect(await readFuelVintage(simDir)).toBeUndefined();
  });

  it('returns undefined when the record is missing its vintage', async () => {
    await write({ requestedYear: 2024 });
    expect(await readFuelVintage(simDir)).toBeUndefined();
  });
});
