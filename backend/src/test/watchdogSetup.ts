/**
 * Opt-in wiring for the slow-test watchdog (#405).
 *
 * A no-op unless NOMAD_TEST_WATCHDOG is set, so ordinary runs are completely
 * unchanged — including CI. The defect under investigation is a hang that
 * appears roughly 1 run in 6-12, so the instrument has to be cheap enough to
 * leave armed across many runs and invisible when it is not wanted.
 *
 *   NOMAD_TEST_WATCHDOG=1 NOMAD_TEST_WATCHDOG_MS=3000 \
 *     NOMAD_TEST_WATCHDOG_FILE=/tmp/stalls.log npx vitest run <file>
 *
 * The timer is unref'd: it must not itself keep the event loop alive, since an
 * unaccounted-for Timeout handle is one of the open leads in #405. An
 * instrument that changes what it measures is worse than none.
 */

import { beforeEach, afterEach } from 'vitest';
import { writePendingReport } from './slowTestWatchdog.js';

const enabled = process.env.NOMAD_TEST_WATCHDOG === '1';

if (enabled) {
  const thresholdMs = Number(process.env.NOMAD_TEST_WATCHDOG_MS ?? 3_000);
  const reportPath = process.env.NOMAD_TEST_WATCHDOG_FILE ?? '/tmp/nomad-test-stalls.log';

  let timer: NodeJS.Timeout | undefined;

  beforeEach((ctx) => {
    const name = ctx.task?.name ?? 'unknown test';
    timer = setTimeout(() => {
      // Fires only if the test is STILL running at the threshold, which for a
      // fully mocked 404 path means it is not slow, it is stuck.
      //
      // `{ Timeout: 1 }` discounts THIS timer. Without it the watchdog reports
      // its own handle: every test showed `Timeout=1` armed and none disarmed,
      // and that phantom was written up on #405 as the only live lead.
      writePendingReport(reportPath, name, thresholdMs, { Timeout: 1 });
    }, thresholdMs);
    timer.unref();
  });

  afterEach(() => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  });
}
