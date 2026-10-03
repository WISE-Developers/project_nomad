/**
 * A real job with its projection removed (refs #294).
 *
 * Since planFgmjImport reads a CRS the file states — inline WKT, or the .prj
 * it names beside itself — SS008-25 no longer produces a crs-blocked plan. It
 * states its own projection and always did; reading it was the fix.
 *
 * But the refusal to invent a CRS still has work to do: 6 of the 66 real .fgmj
 * files carry neither an inline projection nor a reachable .prj, and for those
 * a guess would complete, look plausible, and put the fire hundreds of
 * kilometres away. Every test that guards that behaviour needs a plan which
 * genuinely states nothing.
 *
 * Derived from the real artifact rather than hand-built, so everything except
 * the projection is exactly what production sees. Shared rather than repeated,
 * because four suites need the same thing and four copies of a fixture drift.
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path, { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'test-data');

/** The three-scenario Prometheus export every one of these suites builds on. */
export const THREE_SCENARIOS = 'prometheus_job_SS008-25_3scenarios.fgmj';

/**
 * Writes `file` with its grid projection stripped to a temp directory, hands
 * the path to `use`, and removes it afterwards — including on failure.
 *
 * `filename` is left pointing at a .prj that is deliberately NOT created, so
 * the sidecar branch is exercised and correctly finds nothing.
 */
export function withoutProjection<T>(
  use: (jobPath: string) => T,
  file: string = THREE_SCENARIOS,
): T {
  const raw = JSON.parse(readFileSync(join(TEST_DATA, file), 'utf-8')) as {
    project: { grid: { projection: Record<string, unknown> } };
  };
  delete raw.project.grid.projection.wkt;
  delete raw.project.grid.projection.contents;
  raw.project.grid.projection.filename = 'Inputs/dataset.prj';

  const dir = mkdtempSync(join(tmpdir(), 'fgmj-noproj-'));
  try {
    const jobPath = join(dir, 'job.fgmj');
    writeFileSync(jobPath, JSON.stringify(raw));
    return use(jobPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
