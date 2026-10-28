/**
 * #480 third-stage config: base config plus the CORRELATED socket probe.
 *
 * Separate from vitest.config.ts and from vitest.probe.config.ts on purpose —
 * this one patches http.request as well as http.createServer, and neither must
 * ever load in an ordinary run or in CI on the strength of a stray env var.
 *
 *   NOMAD_TEST_SOCKET_PROBE=1 npx vitest run --config vitest.socketprobe.config.ts
 */
import base from './vitest.config.js';

const test = base.test ?? {};

export default {
  ...base,
  test: {
    ...test,
    setupFiles: [...(test.setupFiles as string[]), './src/test/correlatedSocketProbe.ts'],
  },
};
