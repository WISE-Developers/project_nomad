/**
 * Filesystem adapter for IFuelDatasetCatalog (refs #319).
 *
 * Reads {gridRoot}/{year}/dataset.json, written by
 * scripts/install-firestarr-dataset.sh when it installs a vintage.
 *
 * Resolution order mirrors FireSTARRInputGenerator.findFuelGridForCoordinates:
 * {year}/ first, then default/. Keep the two in step — if they diverge, the UI
 * reports a vintage the run never used.
 */

import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type {
  FuelDataset,
  IFuelDatasetCatalog,
  ResolvedFuelDataset,
} from '../../application/interfaces/IFuelDatasetCatalog.js';
import { resolveDatasetGridRoot } from './FireSTARRInputGenerator.js';

/** Directory name used when a dataset is installed without a vintage. */
const DEFAULT_DIR = 'default';
const MANIFEST = 'dataset.json';

export interface FuelDatasetCatalogConfig {
  /** Absolute path to {datasetPath}/generated/grid/100m. */
  readonly gridRoot: string;
}

/** Shape written by the installer; every field beyond vintage is optional. */
interface DatasetManifest {
  vintage?: number;
  edition?: string;
  label?: string;
  buildDate?: string;
  resolution_m?: number;
  source?: { provider?: string; producer?: string };
}

export class FileSystemFuelDatasetCatalog implements IFuelDatasetCatalog {
  private readonly gridRoot: string;

  constructor(config: FuelDatasetCatalogConfig) {
    if (!config.gridRoot) {
      throw new Error('FileSystemFuelDatasetCatalog requires a gridRoot');
    }
    this.gridRoot = config.gridRoot;
  }

  async listInstalled(): Promise<FuelDataset[]> {
    if (!existsSync(this.gridRoot)) {
      return [];
    }

    const entries = await readdir(this.gridRoot, { withFileTypes: true });
    const datasets: FuelDataset[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === DEFAULT_DIR) {
        continue;
      }
      const dataset = await this.readManifest(entry.name);
      // A year directory with no readable manifest is reported as absent
      // rather than guessed at — an invented vintage is worse than none.
      if (dataset) {
        datasets.push(dataset);
      }
    }

    return datasets.sort((a, b) => a.vintage - b.vintage);
  }

  async resolveForYear(modelYear: number): Promise<ResolvedFuelDataset> {
    const exact = await this.readManifest(String(modelYear));
    if (exact) {
      return {
        requestedYear: modelYear,
        vintage: exact.vintage,
        matchedRequestedYear: true,
        usedFallback: false,
        dataset: exact,
      };
    }

    // Same fallback the input generator performs.
    const defaultDir = join(this.gridRoot, DEFAULT_DIR);
    if (existsSync(defaultDir)) {
      const fallback = await this.readManifest(DEFAULT_DIR);
      return {
        requestedYear: modelYear,
        vintage: fallback?.vintage,
        matchedRequestedYear: false,
        usedFallback: true,
        dataset: fallback ?? undefined,
      };
    }

    return {
      requestedYear: modelYear,
      matchedRequestedYear: false,
      usedFallback: false,
    };
  }

  /** Reads and maps one dataset.json; undefined when missing or unreadable. */
  private async readManifest(dirName: string): Promise<FuelDataset | undefined> {
    const manifestPath = join(this.gridRoot, dirName, MANIFEST);
    if (!existsSync(manifestPath)) {
      return undefined;
    }

    let parsed: DatasetManifest;
    try {
      parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as DatasetManifest;
    } catch (error) {
      console.warn(`[FuelDatasetCatalog] Unreadable ${MANIFEST} at ${manifestPath}: ${String(error)}`);
      return undefined;
    }

    // Directory name wins only when the manifest omits the vintage: the
    // directory is what fuel lookup keys on.
    const vintage = parsed.vintage ?? Number(dirName);
    if (!Number.isFinite(vintage)) {
      return undefined;
    }

    return {
      vintage,
      edition: parsed.edition,
      label: parsed.label,
      producer: parsed.source?.producer,
      provider: parsed.source?.provider,
      buildDate: parsed.buildDate,
      resolutionM: parsed.resolution_m,
    };
  }
}

/**
 * Creates the catalog from environment configuration.
 * Shares gridRoot resolution with the input generator so the catalog can never
 * report a vintage from a different directory than fuel lookup reads.
 */
export function createFileSystemFuelDatasetCatalog(): FileSystemFuelDatasetCatalog {
  return new FileSystemFuelDatasetCatalog({ gridRoot: resolveDatasetGridRoot() });
}
