/**
 * Characterization tests for ModelExecutionService engine-selection behavior.
 *
 * Phase-2 remediation Item 1 (inventory #1/#2): these tests PIN the current
 * behavior of the two `switch (engineType)` blocks
 *   - isEngineAvailable()  (ModelExecutionService.ts:122)
 *   - getEngineCommand()   (ModelExecutionService.ts:273, private)
 * BEFORE introducing a getEngine() resolver registry. They must stay green
 * across the refactor — any change is a behavior change, which is forbidden.
 *
 * Written first per TDD: characterization of existing behavior (green now),
 * not new behavior (no red).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EngineType } from '../../../domain/entities/index.js';

// Control the docker executor the service reaches through `getDockerExecutor()`.
const mockIsAvailable = vi.fn();
const mockIsServiceAvailable = vi.fn();
vi.mock('../../docker/index.js', () => ({
  getDockerExecutor: () => ({
    isAvailable: mockIsAvailable,
    isServiceAvailable: mockIsServiceAvailable,
  }),
}));

import { ModelExecutionService } from '../ModelExecutionService.js';

/** A jobQueue stub — isEngineAvailable/getEngineCommand never touch it. */
function makeService(): ModelExecutionService {
  return new ModelExecutionService({} as never);
}

const ENV_KEYS = ['FIRESTARR_EXECUTION_MODE', 'FIRESTARR_BINARY_PATH'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  mockIsAvailable.mockReset();
  mockIsServiceAvailable.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe('ModelExecutionService.isEngineAvailable (current behavior)', () => {
  describe('FireSTARR — binary execution mode', () => {
    it('returns false when FIRESTARR_BINARY_PATH is not configured', async () => {
      process.env.FIRESTARR_EXECUTION_MODE = 'binary';
      const svc = makeService();
      await expect(svc.isEngineAvailable(EngineType.FireSTARR)).resolves.toBe(false);
    });

    it('returns false when the configured binary is not executable / missing', async () => {
      process.env.FIRESTARR_EXECUTION_MODE = 'binary';
      process.env.FIRESTARR_BINARY_PATH = '/nonexistent/path/to/firestarr-binary';
      const svc = makeService();
      await expect(svc.isEngineAvailable(EngineType.FireSTARR)).resolves.toBe(false);
    });
  });

  describe('FireSTARR — docker execution mode (default)', () => {
    it('returns false when Docker is not available', async () => {
      mockIsAvailable.mockResolvedValue(false);
      const svc = makeService();
      await expect(svc.isEngineAvailable(EngineType.FireSTARR)).resolves.toBe(false);
      expect(mockIsAvailable).toHaveBeenCalledTimes(1);
    });

    it('returns true (dev stub) when Docker is available but the firestarr-app service is not', async () => {
      mockIsAvailable.mockResolvedValue(true);
      mockIsServiceAvailable.mockResolvedValue(false);
      const svc = makeService();
      await expect(svc.isEngineAvailable(EngineType.FireSTARR)).resolves.toBe(true);
      expect(mockIsServiceAvailable).toHaveBeenCalledWith('firestarr-app');
    });

    it('returns true when Docker and the firestarr-app service are both available', async () => {
      mockIsAvailable.mockResolvedValue(true);
      mockIsServiceAvailable.mockResolvedValue(true);
      const svc = makeService();
      await expect(svc.isEngineAvailable(EngineType.FireSTARR)).resolves.toBe(true);
    });
  });

  describe('other engine types', () => {
    it('returns true for WISE (stub, not yet implemented)', async () => {
      const svc = makeService();
      await expect(svc.isEngineAvailable(EngineType.WISE)).resolves.toBe(true);
    });

    it('returns false for an unknown engine type', async () => {
      const svc = makeService();
      await expect(svc.isEngineAvailable('not-a-real-engine')).resolves.toBe(false);
    });
  });
});

describe('ModelExecutionService.getEngineCommand (current behavior)', () => {
  // getEngineCommand is private and reads only model.id and model.engineType.
  const callGetEngineCommand = (engineType: string, id = 'model-123') =>
    (makeService() as unknown as {
      getEngineCommand(m: { id: string; engineType: string }): {
        cmd: string;
        args: string[];
        cwd?: string;
        env?: Record<string, string>;
      };
    }).getEngineCommand({ id, engineType });

  it('FireSTARR: returns the exact stub shell command embedding the model id', () => {
    const cmd = callGetEngineCommand(EngineType.FireSTARR, 'model-123');
    expect(cmd.cmd).toBe('sh');
    expect(cmd.args[0]).toBe('-c');
    expect(cmd.args[1]).toBe(
      'echo "Starting FireSTARR simulation for model model-123..." && ' +
        'echo "[NOTE] Using stub execution - Docker not connected" && ' +
        'sleep 1 && echo "Running scenario 1 of 10" && ' +
        'sleep 1 && echo "Running scenario 5 of 10" && ' +
        'sleep 1 && echo "Running scenario 10 of 10" && ' +
        'sleep 1 && echo "Total simulation time was 4.0 seconds" && ' +
        'echo "Simulation complete"'
    );
  });

  it('WISE: returns the exact stub shell command embedding the model id', () => {
    const cmd = callGetEngineCommand(EngineType.WISE, 'model-xyz');
    expect(cmd.cmd).toBe('sh');
    expect(cmd.args[0]).toBe('-c');
    expect(cmd.args[1]).toBe(
      'echo "Starting WISE simulation for model model-xyz..." && ' +
        'echo "[NOTE] WISE engine not yet implemented" && ' +
        'sleep 1 && echo "Progress: 25%" && ' +
        'sleep 1 && echo "Progress: 50%" && ' +
        'sleep 1 && echo "Progress: 75%" && ' +
        'sleep 1 && echo "Progress: 100%" && ' +
        'echo "Simulation complete"'
    );
  });

  it('unknown engine type: returns the echo "Unknown engine type" fallback command', () => {
    const cmd = callGetEngineCommand('mystery-engine', 'model-7');
    expect(cmd.cmd).toBe('echo');
    expect(cmd.args).toEqual(['Unknown engine type: mystery-engine']);
  });
});
