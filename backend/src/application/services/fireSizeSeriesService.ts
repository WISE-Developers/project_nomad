/**
 * Resolve a model's per-day fire-size ensemble (#418).
 *
 * The run directory is not stored anywhere: it is derived from the path of a
 * result file, which is how every other artifact lookup in this codebase finds
 * it. Dependencies are passed in so the real code path is testable without a
 * database or a filesystem.
 */

import type { FireSizeSeriesArtifact } from '../interfaces/index.js';

/** The subset of a stored result this resolution needs. */
export interface ResultWithPath {
  metadata: { filePath?: unknown };
}

/** The subset of IResultArtifactGateway this resolution needs. */
export interface FireSizeGateway {
  resolveResultFilePath(relativePath: string): string;
  readFireSizeSeries(simDir: string): FireSizeSeriesArtifact;
}

export interface FireSizeSeriesResolution {
  /**
   * False means NO ENSEMBLE WAS RECORDED, which is not the same as an ensemble
   * of zero — 12 of 73 real run directories hold no `sizes_*.csv` at all. A
   * caller that reads only `days.length` cannot tell those apart, so the flag
   * and the reason are part of the contract.
   */
  hasEnsemble: boolean;
  series: FireSizeSeriesArtifact | null;
  /** Why there is no ensemble. Null when there is one. */
  reason: string | null;
}

export async function resolveFireSizeSeries(
  modelId: string,
  findResults: (modelId: string) => Promise<ResultWithPath[]>,
  gateway: FireSizeGateway,
): Promise<FireSizeSeriesResolution> {
  const results = await findResults(modelId);

  if (results.length === 0) {
    return { hasEnsemble: false, series: null, reason: 'this model has no results yet' };
  }

  // Keep looking rather than giving up on the first result: a result without a
  // file path is a record of something that produced no artifact, and the run
  // directory is still discoverable from any sibling that did.
  let simDir: string | null = null;
  for (const result of results) {
    const filePath = result.metadata.filePath;
    if (typeof filePath !== 'string' || filePath.length === 0) continue;
    const resolved = gateway.resolveResultFilePath(filePath);
    simDir = resolved.slice(0, Math.max(0, resolved.lastIndexOf('/')));
    break;
  }

  if (simDir === null) {
    return {
      hasEnsemble: false,
      series: null,
      reason: 'no result for this model carries a file path, so its run directory cannot be located',
    };
  }

  const series = gateway.readFireSizeSeries(simDir);
  if (series.n === null || series.days.length === 0) {
    return {
      hasEnsemble: false,
      series: null,
      reason: 'this run recorded no fire-size files, so it has no ensemble to summarise',
    };
  }

  return { hasEnsemble: true, series, reason: null };
}
