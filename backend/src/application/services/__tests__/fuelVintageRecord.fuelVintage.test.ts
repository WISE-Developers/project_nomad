/**
 * A recorded run must report its FUEL VINTAGE, not just the dataset directory
 * it used — issue #431.
 *
 * `readFuelVintage` returns the recorded directory name ("2024", "default").
 * That is the dataset year, and the results view was displaying it under the
 * label "fuel vintage". The vintage is one year earlier.
 *
 * Derived here, server-side, rather than in the frontend: the same record feeds
 * Pack-and-Go reporting (#426) and openNomad consumers, and the rule must not
 * live in one consumer. The domain owns it — fuelVintageForDatasetYear.
 *
 * The ON-DISK field keeps the name `vintage` and its existing meaning. Rewriting
 * what completed runs recorded is the failure #331 closed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFuelVintage } from '../fuelVintageRecord.js';

let simDir: string;

async function writeRecord(record: Record<string, unknown>): Promise<void> {
  await writeFile(join(simDir, 'fuel-vintage.json'), JSON.stringify(record), 'utf-8');
}

beforeEach(async () => {
  simDir = await mkdtemp(join(tmpdir(), 'nomad-fuelvintage-'));
});

afterEach(async () => {
  await rm(simDir, { recursive: true, force: true });
});

describe('readFuelVintage reports the fuel vintage separately (#431)', () => {
  it('derives the fuel vintage as one year before the recorded dataset year', async () => {
    await writeRecord({
      requestedYear: 2026,
      vintage: '2026',
      matchedRequestedYear: true,
      usedFallback: false,
    });

    const record = await readFuelVintage(simDir);

    expect(record?.datasetYear).toBe(2026);
    expect(record?.fuelVintage).toBe(2025);
  });

  it('keeps the recorded directory name untouched', async () => {
    // The stored value is evidence of what happened. It is not rewritten.
    await writeRecord({
      requestedYear: 2026,
      vintage: '2026',
      matchedRequestedYear: true,
      usedFallback: false,
    });

    const record = await readFuelVintage(simDir);

    expect(record?.vintage).toBe('2026');
  });

  it('derives from the dataset ACTUALLY used when the run fell back', async () => {
    // A 2023 run that used the 2026 dataset ran on 2025-vintage fuel.
    await writeRecord({
      requestedYear: 2023,
      vintage: '2026',
      matchedRequestedYear: false,
      usedFallback: true,
    });

    const record = await readFuelVintage(simDir);

    expect(record?.requestedYear).toBe(2023);
    expect(record?.datasetYear).toBe(2026);
    expect(record?.fuelVintage).toBe(2025);
    expect(record?.fuelVintage).not.toBe(2022);
  });

  it('reports no vintage for a non-numeric dataset directory', async () => {
    // "default" carries no year. Never inferred — #331's rule.
    await writeRecord({
      requestedYear: 2026,
      vintage: 'default',
      matchedRequestedYear: false,
      usedFallback: true,
    });

    const record = await readFuelVintage(simDir);

    expect(record?.vintage).toBe('default');
    expect(record?.datasetYear).toBeUndefined();
    expect(record?.fuelVintage).toBeUndefined();
  });
});
