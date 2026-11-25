/**
 * Startup recovery kills leftover engine containers FIRST, and refuses to go on when it
 * cannot (verification/job-lifecycle, RestartLeavesNoEngine).
 *
 * A failed sweep must stop the boot: startServer turns the throw into a logged exit(1),
 * so the server never listens beside a container it could not stop.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { recoverAfterRestart } from '../startupRecovery.js';

describe('recoverAfterRestart', () => {
  it('removes leftover containers before it recovers jobs and models', async () => {
    const order: string[] = [];
    await recoverAfterRestart({
      killLeftoverEngines: async () => {
        order.push('sweep');
        return ['nomad-run-a'];
      },
      jobQueue: { initialize: async () => { order.push('jobs'); } },
    });
    expect(order).toEqual(['sweep', 'jobs']);
  });

  it('fails loudly, and recovers nothing, when the sweep cannot be confirmed', async () => {
    const initialize = vi.fn(async () => undefined);

    const boot = recoverAfterRestart({
      killLeftoverEngines: async () => {
        throw new Error('Cannot connect to the Docker daemon');
      },
      jobQueue: { initialize },
    });

    await expect(boot).rejects.toThrow(/leftover engine containers.*Cannot connect to the Docker daemon/);
    expect(initialize).not.toHaveBeenCalled();
  });
});

describe('the server runs it at boot', () => {
  const index = readFileSync(join(__dirname, '..', '..', '..', 'index.ts'), 'utf8');

  it('sweeps with the FireSTARR executor, inside initializeDatabaseLayer', () => {
    expect(index).toMatch(/recoverAfterRestart\(\{[^}]*getFireSTARRExecutor\(\)\.killLeftovers\(\)/s);
  });

  it('does not bypass the sweep by calling JobQueue.initialize directly', () => {
    expect(index).not.toMatch(/getJobQueue\(\)\.initialize\(\)/);
  });

  it('runs before the server listens', () => {
    expect(index.indexOf('await initializeDatabaseLayer()')).toBeLessThan(index.indexOf('app.listen('));
  });
});
