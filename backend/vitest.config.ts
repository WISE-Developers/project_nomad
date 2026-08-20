import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration — issue #359.
 *
 * The suite had no config at all, so it ran on Vitest's default 5-second test
 * timeout. Several tests here do real work rather than mocking it: writing and
 * re-reading the JSONL usage log, loading the real v1 router (which runs
 * migrations), generating FireSTARR inputs. Individually those finish in well
 * under a second.
 *
 * Under a fully parallel run they contend, and whichever one happens to be
 * slowest at that moment crosses 5s and fails. That is why a DIFFERENT test
 * failed on each full-suite run, why it never reproduced when those files were
 * run on their own, and why it looked like shared state — the usage tests do
 * the most file I/O, so they were the most frequent casualty.
 *
 * Reproduced deliberately by running two full suites concurrently, which failed
 * `modelsPreflight > route registration` with "Test timed out in 5000ms".
 *
 * A longer timeout is the correct fix rather than a papered-over one: nothing
 * here is meant to complete in 5 seconds specifically, and a timeout that
 * doubles as a performance assertion produces exactly this — failures that
 * point at the wrong test and teach people to re-run instead of read.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
