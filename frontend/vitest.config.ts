import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Point ICU at the timezone data this product ships (refs #364, #365).
 *
 * `backend/vitest.config.ts` has done this since #364; the frontend never did,
 * and that asymmetry is what let a wrong timezone assertion sit green locally
 * and red in CI for a day. Without it the suite asserts against whatever tzdata
 * the developer's Node happens to bundle -- which is not what runs in
 * production and is usually OLDER. A stale runtime produces no error: it
 * returns a plausible time that is one hour out.
 */
process.env.ICU_TIMEZONE_FILES_DIR =
  process.env.ICU_TIMEZONE_FILES_DIR ?? path.resolve(__dirname, '../vendor/icu-tzdata/2026c');

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    /**
     * Four workers, not the ~12 vitest derives from the CPU count.
     *
     * Each worker builds its own jsdom and transforms its own modules, and this
     * repo lives on a USB-backed volume. Twelve of them starve each other, and
     * whichever test is mid-flight when a stall lands blows the 5000 ms default
     * timeout — a DIFFERENT test each run, across unrelated features, which is
     * what made it look like a product bug rather than the pool.
     *
     * Measured 2026-10-02: default ~12 workers failed 2 of 6 runs at 29s;
     * maxWorkers 4 passed 5 of 5 at 28-29s; fully serial passed but took 86s.
     * Capping costs nothing because the bottleneck is I/O, not CPU.
     *
     * Deliberately NOT a testTimeout increase — that would hide the stalls
     * instead of stopping them.
     */
    maxWorkers: 4,
    globals: true,
    env: {
      ICU_TIMEZONE_FILES_DIR: process.env.ICU_TIMEZONE_FILES_DIR,
    },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
