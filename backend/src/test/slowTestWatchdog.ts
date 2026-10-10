/**
 * Reports WHAT is still pending when a test stalls (#405).
 *
 * `models.engineWiring.characterization.test.ts` hangs about 1 run in 6-12, a
 * different case each time, always as a timeout and never a wrong assertion.
 * The cases that hang are fully mocked 404 paths that should finish in
 * milliseconds, so passing 30s means the request never returns at all.
 *
 * All the evidence today is "Test timed out in 30000ms" plus a test name. That
 * absence is what made the first #414 diagnosis wrong as well: with nothing to
 * look at, the plausible story got believed. This captures the open handles at
 * the moment of the stall rather than waiting 30s to learn nothing.
 *
 * Two rules this instrument must obey:
 *
 * 1. **Write to a file.** An earlier probe in this repo logged to console and
 *    the Vitest 4 reporter swallowed every line — six runs reported "6 passed"
 *    with zero output logged, and it nearly got reported as a finding.
 * 2. **Never hold the loop open.** The watchdog timer is unref'd. An
 *    unaccounted-for `Timeout` handle is one of the live leads here, so an
 *    instrument that adds one would be measuring itself.
 *
 * It is also diagnostic only: every write is wrapped, because a probe must
 * never be the reason a suite goes red.
 */

import { appendFileSync } from 'fs';

export interface PendingSnapshot {
  /** Every active resource, one entry per resource. */
  resources: string[];
  /** The same thing tallied by kind — what you actually read. */
  counts: Record<string, number>;
}

/** Internal Node accessor; absent on some runtimes, so it is probed, not assumed. */
type MaybeHandleLister = { _getActiveHandles?: () => unknown[] };

export interface CaptureOptions {
  /**
   * Resources belonging to the instrument itself, subtracted from the tally:
   * `{ Timeout: 1 }` drops one Timeout entry.
   *
   * Not optional hygiene. With the watchdog armed, every test in
   * models.engineWiring.characterization.test.ts reported `Timeout=1`; with it
   * disarmed, the same tests report none. That was the watchdog's own timer,
   * and it went into #405 as "the only live lead" — a ghost the instrument
   * created and then pointed at (measured 2026-10-10).
   *
   * Counted by NAME rather than by object identity because timers cannot be
   * excluded by identity: `process._getActiveHandles()` does not list them at
   * all, so `getActiveResourcesInfo()` is the only source that sees a Timeout
   * and it reports names, not objects. Verified 2026-10-10 — the identity
   * design was written first and did not work.
   */
  ignore?: Record<string, number>;
}

/**
 * Everything currently keeping the event loop alive.
 *
 * Two sources, because they disagree usefully: `getActiveResourcesInfo()` names
 * libuv resource types (`TCPSERVERWRAP`, `Timeout`), while the handle list
 * gives JS constructor names (`Server`, `Socket`). A leaked supertest server
 * shows up differently in each, and seeing both is the point.
 */
export function capturePending(options: CaptureOptions = {}): PendingSnapshot {
  const resources: string[] = [];
  const remaining = { ...(options.ignore ?? {}) };

  try {
    if (typeof process.getActiveResourcesInfo === 'function') {
      for (const name of process.getActiveResourcesInfo()) {
        if ((remaining[name] ?? 0) > 0) {
          remaining[name] -= 1;
          continue;
        }
        resources.push(name);
      }
    }
  } catch {
    // Diagnostic only — a runtime without it still gets the handle list below.
  }

  try {
    const lister = process as unknown as MaybeHandleLister;
    for (const handle of lister._getActiveHandles?.() ?? []) {
      const name = (handle as { constructor?: { name?: string } })?.constructor?.name ?? 'Unknown';
      if ((remaining[name] ?? 0) > 0) {
        remaining[name] -= 1;
        continue;
      }
      resources.push(name);
    }
  } catch {
    // Internal API; its absence is not worth failing over.
  }

  const counts: Record<string, number> = {};
  for (const name of resources) {
    counts[name] = (counts[name] ?? 0) + 1;
  }

  return { resources, counts };
}

/**
 * Appends one stall entry. Appends rather than truncates so a run that stalls
 * more than once keeps every entry — the defect shows a *different* test each
 * time, so the set across runs is the evidence, not any single entry.
 */
export function writePendingReport(
  path: string,
  testName: string,
  afterMs: number,
  ignore: Record<string, number> = {},
): void {
  try {
    const { counts } = capturePending({ ignore });
    const tally = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name}=${n}`)
      .join(' ');

    const entry = [
      `[${new Date().toISOString()}] STALL after ${afterMs}ms`,
      `  test: ${testName}`,
      `  pending: ${tally || '(none reported)'}`,
      '',
    ].join('\n');

    appendFileSync(path, entry, 'utf-8');
  } catch {
    // A probe that cannot write must stay silent rather than fail the suite.
  }
}
