/**
 * #480 investigation config — base config plus the request-arrival probe.
 *
 * Kept separate from vitest.config.ts deliberately: the probe monkey-patches
 * http.createServer, and that must never load in an ordinary run or in CI on
 * the strength of an env var someone forgot to unset.
 *
 *   NOMAD_TEST_WATCHDOG=1 NOMAD_TEST_ARRIVAL_PROBE=1 \
 *     npx vitest run --config vitest.probe.config.ts
 */

import base from './vitest.config.js';

const test = base.test ?? {};

export default {
  ...base,
  test: {
    ...test,
    setupFiles: [...(test.setupFiles as string[]), './src/test/requestArrivalProbe.ts'],
  },
};
