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
