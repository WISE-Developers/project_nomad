/**
 * FileSystemFuelDatasetCatalog — reads installed fuel dataset vintages (refs #319)
 *
 * The installer writes one dataset.json per vintage into
 * {gridRoot}/{year}/dataset.json. Nothing in the app read it, so the UI could
 * not tell the user which fuel their run actually used.
 *
 * Resolution MUST mirror FireSTARRInputGenerator.findFuelGridForCoordinates:
 * {year}/ first, then default/. If the catalog disagreed with the generator,
 * the UI would confidently report a vintage the run never used.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { FileSystemFuelDatasetCatalog } from '../FileSystemFuelDatasetCatalog.js';

/** Matches what scripts/install-firestarr-dataset.sh installs per year. */
function datasetJson(year: number) {
  return JSON.stringify({
    vintage: year,
    edition: '1.0',
    label: `Sam's 100m fuel layer -> UTM grids (Jordan Evens); start-of-${year} state, input for ${year} model runs`,
    source: { provider: 'NRCan/CFS', producer: 'Jordan Evens', derivedFrom: "Sam's 100m fuel layer" },
    buildDate: `${year}-11-01`,
    resolution_m: 100,
    grid: { path: `generated/grid/100m/${year}`, fuelTiles: 12, demTiles: 12 },
  });
}

describe('FileSystemFuelDatasetCatalog', () => {
  let tempDir: string;
  let gridRoot: string;
  let catalog: FileSystemFuelDatasetCatalog;

  const installYear = async (year: number | 'default', withManifest = true) => {
    const dir = join(gridRoot, String(year));
    await mkdir(dir, { recursive: true });
    if (withManifest) {
      await writeFile(join(dir, 'dataset.json'), datasetJson(Number(year) || 0), 'utf8');
    }
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fuel-catalog-test-'));
    gridRoot = join(tempDir, 'generated', 'grid', '100m');
    await mkdir(gridRoot, { recursive: true });
    catalog = new FileSystemFuelDatasetCatalog({ gridRoot });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('listInstalled', () => {
    it('returns installed vintages in ascending year order', async () => {
      await installYear(2026);
      await installYear(2023);
      await installYear(2025);

      const installed = await catalog.listInstalled();

      expect(installed.map(d => d.vintage)).toEqual([2023, 2025, 2026]);
    });

    it('carries the provenance the installer wrote', async () => {
      await installYear(2025);

      const [dataset] = await catalog.listInstalled();

      expect(dataset.vintage).toBe(2025);
      expect(dataset.edition).toBe('1.0');
      expect(dataset.label).toContain('start-of-2025');
      expect(dataset.producer).toBe('Jordan Evens');
    });

    it('returns an empty list when no dataset is installed', async () => {
      expect(await catalog.listInstalled()).toEqual([]);
    });

    it('ignores a year directory with no dataset.json rather than inventing one', async () => {
      await installYear(2024, false);
      await installYear(2025);

      const installed = await catalog.listInstalled();

      expect(installed.map(d => d.vintage)).toEqual([2025]);
    });
  });

  describe('resolveForYear', () => {
    it('resolves an exactly-matching vintage', async () => {
      await installYear(2023);
      await installYear(2026);

      const resolved = await catalog.resolveForYear(2023);

      expect(resolved.vintage).toBe(2023);
      expect(resolved.matchedRequestedYear).toBe(true);
      expect(resolved.usedFallback).toBe(false);
    });

    it('falls back to default/ and says so when the requested year is absent', async () => {
      await installYear(2026);
      await installYear('default');

      const resolved = await catalog.resolveForYear(2023);

      expect(resolved.matchedRequestedYear).toBe(false);
      expect(resolved.usedFallback).toBe(true);
      expect(resolved.requestedYear).toBe(2023);
    });

    it('reports nothing resolved when neither the year nor default/ exists', async () => {
      await installYear(2026);

      const resolved = await catalog.resolveForYear(2023);

      expect(resolved.matchedRequestedYear).toBe(false);
      expect(resolved.usedFallback).toBe(false);
      expect(resolved.vintage).toBeUndefined();
    });

    it('prefers the exact year over default/ — same order as the input generator', async () => {
      await installYear(2023);
      await installYear('default');

      const resolved = await catalog.resolveForYear(2023);

      expect(resolved.matchedRequestedYear).toBe(true);
      expect(resolved.usedFallback).toBe(false);
    });
  });
});
