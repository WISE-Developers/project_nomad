/**
 * The recorded producer must survive the read back (#431).
 *
 * The run writes `producer` into fuel-vintage.json; this is the other half —
 * without it the field is written to disk and then dropped on the way to the
 * UI, which is indistinguishable from never recording it at all.
 *
 * Records written before #431 have no producer and must still read cleanly:
 * ten such records already exist on this machine, including the real
 * 2026-10-08 run, and they can never gain one retroactively.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { readFuelVintage } from '../fuelVintageRecord.js';

let simDir: string;

beforeEach(async () => {
  simDir = await mkdtemp(join(tmpdir(), 'fuel-producer-read-'));
});

afterEach(async () => {
  await rm(simDir, { recursive: true, force: true });
});

async function write(record: Record<string, unknown>): Promise<void> {
  await writeFile(join(simDir, 'fuel-vintage.json'), JSON.stringify(record), 'utf-8');
}

describe('readFuelVintage — producer (#431)', () => {
  it('returns the producer the run recorded', async () => {
    await write({
      requestedYear: 2023,
      vintage: '2023',
      matchedRequestedYear: true,
      usedFallback: false,
      producer: 'Jordan Evens',
    });

    const record = await readFuelVintage(simDir);

    expect(record?.producer).toBe('Jordan Evens');
    // Derivation is unaffected by the new field.
    expect(record?.datasetYear).toBe(2023);
    expect(record?.fuelVintage).toBe(2022);
  });

  it('reads pre-#431 records, which have no producer, without complaint', async () => {
    // Exactly the shape of the real 2026-10-08 run.
    await write({
      requestedYear: 2023,
      vintage: '2023',
      matchedRequestedYear: true,
      usedFallback: false,
      gridPath: '/data/generated/grid/100m/2023/fuel_12_0.tif',
      recordedAt: '2026-10-08T12:23:00.094Z',
    });

    const record = await readFuelVintage(simDir);

    expect(record).toBeDefined();
    expect(record?.producer).toBeUndefined();
    expect(record?.fuelVintage).toBe(2022);
  });
});
