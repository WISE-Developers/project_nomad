import { configDefaults, defineConfig } from 'vitest/config';

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
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Point ICU at the timezone data this product ships (refs #364, #365).
 *
 * Without this the suite asserts against whatever tzdata the developer's
 * Node happens to bundle, which is not what runs in production and is
 * usually older. Setting it here means the timezone tests exercise the
 * same data as the container.
 */
process.env.ICU_TIMEZONE_FILES_DIR =
  process.env.ICU_TIMEZONE_FILES_DIR ?? resolve(here, '../vendor/icu-tzdata/2026c');

export default defineConfig({
  test: {
    /**
     * Never collect tests out of dist/ (refs #384).
     *
     * `tsc -b` compiles the suite alongside the source, so dist/ holds a
     * COMPILED COPY of all 88 test files. Vitest 2 excluded dist/ by default;
     * Vitest 4 does not, so the bump made every test run twice -- once from
     * source and once from whatever stale JS the last build left behind.
     *
     * Those stale copies then failed on Vitest 4's stricter mocked-class
     * construction while the identical source test passed, which reads as a
     * real regression and is not one. Excluded explicitly rather than trusting
     * a default that has already changed once.
     */
    exclude: [...configDefaults.exclude, 'dist/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      ICU_TIMEZONE_FILES_DIR: process.env.ICU_TIMEZONE_FILES_DIR,
    },
  },
});
