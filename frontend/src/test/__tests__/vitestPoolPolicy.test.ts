/**
 * @vitest-environment node
 *
 * The vite config pulls in esbuild internals that assume Node globals; under
 * jsdom the import dies on a TextEncoder invariant before any assertion runs.
 */
/**
 * Test files run SERIALLY on a developer machine and in PARALLEL in CI.
 *
 * This machine is not one person's. Synthesis, Circuit, Compass, Meridian, Sage,
 * Ollama and Claude Desktop are all live on it at once, reading from the same
 * USB-backed volume. Four vitest workers each build their own jsdom and
 * re-transform their own modules, and they do not contend with the hardware —
 * they contend with whoever else is working.
 *
 * Measured 2026-10-04, 8 runs per mode:
 *
 *   serial            3/3 clean   91-95s
 *   maxWorkers 4      0/8 clean   120-147s   (2-5 timeouts per run)
 *   maxWorkers 12     4/8 failed  117-164s   (once dropped 6 FILES entirely)
 *
 * Parallel is slower AND less reliable here, so there is no speed being bought.
 * At maxWorkers 4 the cumulative `environment` time is 171-257s against a
 * 120-147s wall clock: the workers spend their lives waiting on I/O.
 *
 * CI is different and must stay parallel. There the runner is ours alone for the
 * duration, the suite has been green on every run, and serial would cost minutes
 * of someone's time for nothing.
 *
 * These assertions exist so the policy cannot be quietly reverted by someone
 * who reads `fileParallelism: false` as a performance mistake. It is not — it is
 * both faster here and a smaller share of a shared machine.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

async function loadConfig(ci: string | undefined) {
  vi.resetModules();
  if (ci === undefined) delete process.env.CI;
  else process.env.CI = ci;
  const mod = await import('../../../vitest.config.ts');
  const resolved = typeof mod.default === 'function' ? mod.default({ mode: 'test', command: 'serve' }) : mod.default;
  return await resolved;
}

describe('vitest pool policy', () => {
  const originalCI = process.env.CI;

  beforeEach(() => {
    delete process.env.CI;
  });

  afterEach(() => {
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
  });

  it('runs test files serially on a developer machine', async () => {
    const config = await loadConfig(undefined);
    expect(config.test?.fileParallelism).toBe(false);
  });

  it('runs test files in parallel in CI', async () => {
    const config = await loadConfig('true');
    expect(config.test?.fileParallelism).toBe(true);
  });

  it('still caps CI workers rather than letting the pool size itself', async () => {
    // Twelve workers dropped six whole test FILES in one run and reported the
    // remainder as passing. A cap is not a performance tweak.
    const config = await loadConfig('true');
    expect(config.test?.maxWorkers).toBe(4);
  });
});
