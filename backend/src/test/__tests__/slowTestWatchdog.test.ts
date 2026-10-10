/**
 * A watchdog that says WHAT is pending when a test stalls (#405).
 *
 * models.engineWiring.characterization.test.ts hangs roughly 1 run in 6-12,
 * a different case each time, always as a timeout and never a wrong assertion.
 * The failing cases are fully mocked 404 paths that should finish in
 * milliseconds, so exceeding 30s means the request never returns at all.
 *
 * Today the only evidence is "Test timed out in 30000ms" and a test name.
 * That is what made the first #414 diagnosis wrong too: without knowing what
 * was still open, the obvious story (contention) got believed. This captures
 * the open handles at the moment of the stall instead of waiting 30s to learn
 * nothing.
 *
 * Two constraints the instrument must respect, both learned the hard way:
 *
 * 1. It writes to a FILE. A previous probe in this repo logged to console and
 *    the Vitest 4 reporter swallowed every line — six runs reported "6 passed"
 *    with zero output, and it nearly got reported as evidence.
 * 2. Its own timer is unref'd, so the watchdog cannot itself hold the event
 *    loop open. An instrument that changes what it measures is worthless here,
 *    since an unaccounted-for Timeout handle is one of the open leads.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { capturePending, writePendingReport } from '../slowTestWatchdog.js';

const reportPath = join(tmpdir(), `watchdog-test-${process.pid}.log`);

afterEach(() => {
  if (existsSync(reportPath)) rmSync(reportPath);
});

describe('capturePending (#405)', () => {
  it('names the kinds of resource currently holding the loop', () => {
    const snapshot = capturePending();

    expect(Array.isArray(snapshot.resources)).toBe(true);
    // Node always reports at least its own stdio/loop resources.
    expect(snapshot.resources.length).toBeGreaterThan(0);
  });

  it('counts each resource kind rather than listing duplicates', () => {
    const timer = setInterval(() => {}, 1_000);
    try {
      const snapshot = capturePending();
      const timeouts = snapshot.counts['Timeout'] ?? 0;

      expect(timeouts).toBeGreaterThan(0);
    } finally {
      clearInterval(timer);
    }
  });

  it('notices an open server socket, which is the suspected leak here', async () => {
    const { createServer } = await import('http');
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    try {
      const snapshot = capturePending();

      // supertest starts one ephemeral server per request and nothing closes
      // them; this proves the watchdog would see them if they accumulate.
      expect(Object.keys(snapshot.counts).join(',')).toMatch(/Server|TCP/i);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});

describe('writePendingReport (#405)', () => {
  it('appends a readable entry naming the test and what was pending', () => {
    writePendingReport(reportPath, 'GET /models/:id/results returns 404', 3_000);

    const written = readFileSync(reportPath, 'utf-8');

    expect(written).toContain('GET /models/:id/results returns 404');
    expect(written).toContain('3000ms');
  });

  it('appends rather than truncating, so every stall in a run survives', () => {
    writePendingReport(reportPath, 'first stall', 3_000);
    writePendingReport(reportPath, 'second stall', 3_000);

    const written = readFileSync(reportPath, 'utf-8');

    expect(written).toContain('first stall');
    expect(written).toContain('second stall');
  });

  it('never throws, so a failing probe cannot fail the run', () => {
    // An unwritable path must degrade silently: the watchdog is diagnostic and
    // must never become the reason a suite goes red.
    expect(() => writePendingReport('/nonexistent-dir/x/y.log', 'test', 1)).not.toThrow();
  });
});

/**
 * The watchdog must not report its own timer (#405).
 *
 * Measured 2026-10-10: with the watchdog armed, every test in
 * models.engineWiring.characterization.test.ts reported `Timeout=1`. With it
 * disarmed, the same tests report `Timeouts=0`. That handle was the watchdog's
 * own setTimeout, and it was written into the issue as "the only live lead" —
 * a ghost the instrument created and then pointed at.
 *
 * This is the same failure the file header warns about, committed anyway, so
 * it is now pinned by a test rather than by a comment.
 */
describe('capturePending discounts the instrument’s own resources (#405)', () => {
  it('subtracts exactly the number of entries it is told to ignore', () => {
    const mine = setTimeout(() => {}, 10_000);
    try {
      const withIt = capturePending().counts['Timeout'] ?? 0;
      const withoutIt = capturePending({ ignore: { Timeout: 1 } }).counts['Timeout'] ?? 0;

      expect(withIt).toBeGreaterThan(0);
      expect(withoutIt).toBe(withIt - 1);
    } finally {
      clearTimeout(mine);
    }
  });

  it('still reports the timers it was not told to ignore', () => {
    const a = setTimeout(() => {}, 10_000);
    const b = setTimeout(() => {}, 10_000);
    try {
      // Two of ours plus one of someone else's: ignoring one must not hide all.
      const snapshot = capturePending({ ignore: { Timeout: 1 } });

      expect(snapshot.counts['Timeout'] ?? 0).toBeGreaterThan(0);
    } finally {
      clearTimeout(a);
      clearTimeout(b);
    }
  });

  it('ignores a name that is not present without going negative', () => {
    const snapshot = capturePending({ ignore: { NoSuchResource: 5 } });

    expect(snapshot.counts['NoSuchResource']).toBeUndefined();
  });
});
