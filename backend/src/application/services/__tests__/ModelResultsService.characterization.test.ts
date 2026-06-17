/**
 * Characterization test for ModelResultsService.
 *
 * Pins CURRENT observable behavior of the service obtained via the
 * composition-root factory `getModelResultsService(engine)`. Driven entirely
 * through the public API and asserting on observable return values so it stays
 * invariant across the Clean Architecture (Dependency Inversion) refactor.
 *
 * Infrastructure is mocked at the module boundary the CURRENT code depends on
 * (database + firestarr). After the DIP refactor the factory wires the same
 * concrete functions through a gateway, so these mocks still take effect.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mock infrastructure modules the service (and its factory) reach into ---

const mockResultRepo = {
  findById: vi.fn(),
  findByModelId: vi.fn(),
  save: vi.fn(),
};

const mockJobRepo = {
  findByModelId: vi.fn(),
};

vi.mock('../../../infrastructure/database/index.js', () => ({
  getResultRepository: () => mockResultRepo,
  getJobRepository: () => mockJobRepo,
}));

const mockResolveResultFilePath = vi.fn((p: string) => `/abs/${p}`);

vi.mock('../../../infrastructure/firestarr/FireSTARRInputGenerator.js', () => ({
  resolveResultFilePath: (p: string) => mockResolveResultFilePath(p),
}));

const mockFindArrivalTifs = vi.fn();
const mockExtractDeterministicPerimeters = vi.fn();

vi.mock('../../../infrastructure/firestarr/index.js', () => ({
  findArrivalTifs: (...a: unknown[]) => mockFindArrivalTifs(...a),
  extractDeterministicPerimeters: (...a: unknown[]) =>
    mockExtractDeterministicPerimeters(...a),
}));

import {
  getModelResultsService,
  resetModelResultsService,
} from '../ModelResultsService.js';
import type { IFireModelingEngine } from '../../interfaces/IFireModelingEngine.js';
import type { FireModelId, ModelResultId } from '../../../domain/entities/index.js';

// Minimal engine double — methods overridden per test.
function makeEngine(overrides: Partial<IFireModelingEngine> = {}): IFireModelingEngine {
  return {
    getStatus: vi.fn(),
    getResults: vi.fn(),
    ...overrides,
  } as unknown as IFireModelingEngine;
}

// Plain object shaped like a ModelResult (service reads these fields + getDisplayName()).
function makeResult(over: Record<string, unknown> = {}) {
  return {
    id: 'result-1',
    fireModelId: 'model-1' as FireModelId,
    outputType: 'probability',
    format: 'geotiff',
    metadata: {},
    getDisplayName: () => 'Display Name',
    ...over,
  };
}

describe('ModelResultsService (characterization)', () => {
  beforeEach(() => {
    resetModelResultsService();
    vi.clearAllMocks();
    mockResolveResultFilePath.mockImplementation((p: string) => `/abs/${p}`);
  });

  describe('getResultById', () => {
    it('returns { modelId, result } when the result exists', async () => {
      const result = makeResult({ id: 'r-42', fireModelId: 'm-7' as FireModelId });
      mockResultRepo.findById.mockResolvedValue(result);

      const svc = getModelResultsService(makeEngine());
      const out = await svc.getResultById('r-42' as ModelResultId);

      expect(out).toEqual({ modelId: 'm-7', result });
    });

    it('returns undefined when the result is not found', async () => {
      mockResultRepo.findById.mockResolvedValue(null);

      const svc = getModelResultsService(makeEngine());
      const out = await svc.getResultById('missing' as ModelResultId);

      expect(out).toBeUndefined();
    });
  });

  describe('getResultFilePath', () => {
    it('resolves the relative filePath to an absolute path when present', async () => {
      mockResultRepo.findById.mockResolvedValue(
        makeResult({ metadata: { filePath: 'sim/out.tif' } }),
      );

      const svc = getModelResultsService(makeEngine());
      const out = await svc.getResultFilePath('r-1' as ModelResultId);

      expect(out).toBe('/abs/sim/out.tif');
    });

    it('returns null when the result has no filePath in metadata', async () => {
      mockResultRepo.findById.mockResolvedValue(makeResult({ metadata: {} }));

      const svc = getModelResultsService(makeEngine());
      const out = await svc.getResultFilePath('r-1' as ModelResultId);

      expect(out).toBeNull();
    });

    it('returns null when the result is not found', async () => {
      mockResultRepo.findById.mockResolvedValue(null);

      const svc = getModelResultsService(makeEngine());
      const out = await svc.getResultFilePath('missing' as ModelResultId);

      expect(out).toBeNull();
    });
  });

  describe('getResults', () => {
    it('returns "Model has not been executed" when engine errors and no job/results exist', async () => {
      const engine = makeEngine({
        getStatus: vi.fn().mockRejectedValue(new Error('not configured')),
      });
      mockJobRepo.findByModelId.mockResolvedValue([]);
      mockResultRepo.findByModelId.mockResolvedValue([]);

      const svc = getModelResultsService(engine);
      const res = await svc.getResults(
        'model-x' as FireModelId,
        'My Model',
        'firestarr',
      );

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("expected ok");
      const value = res.value;
      expect(value.modelId).toBe('model-x');
      expect(value.modelName).toBe('My Model');
      expect(value.engineType).toBe('firestarr');
      expect(value.userId).toBeNull();
      expect(value.notes).toBeNull();
      expect(value.outputs).toEqual([]);
      expect(value.executionSummary.status).toBe('queued');
      expect(value.executionSummary.progress).toBe(0);
      expect(value.executionSummary.error).toBe('Model has not been executed');
    });

    it('returns empty outputs when engine reports a non-completed state', async () => {
      const engine = makeEngine({
        getStatus: vi.fn().mockResolvedValue({
          state: 'running',
          progress: 42,
          startedAt: undefined,
          completedAt: undefined,
          updatedAt: new Date(),
        }),
      });

      const svc = getModelResultsService(engine);
      const res = await svc.getResults('model-y' as FireModelId, 'Name', 'firestarr');

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("expected ok");
      const value = res.value;
      expect(value.executionSummary.status).toBe('running');
      expect(value.executionSummary.progress).toBe(42);
      expect(value.outputs).toEqual([]);
    });

    it('maps completed engine results to output items (probabilistic, no inputs)', async () => {
      const engine = makeEngine({
        getStatus: vi.fn().mockResolvedValue({
          state: 'completed',
          progress: 100,
          startedAt: new Date('2026-06-01T00:00:00Z'),
          completedAt: new Date('2026-06-01T00:01:00Z'),
          updatedAt: new Date('2026-06-01T00:01:00Z'),
        }),
        getResults: vi.fn().mockResolvedValue([
          makeResult({
            id: 'r-1',
            outputType: 'probability',
            format: 'geotiff',
            metadata: {}, // no filePath -> inputs block skipped
          }),
        ]),
      });
      // not useDatabase path: existing results check returns empty so it saves.
      mockResultRepo.findByModelId.mockResolvedValue([]);
      mockResultRepo.save.mockResolvedValue(undefined);

      const svc = getModelResultsService(engine);
      const res = await svc.getResults('model-z' as FireModelId, 'Name', 'firestarr');

      expect(res.success).toBe(true);
      if (!res.success) throw new Error("expected ok");
      const value = res.value;
      expect(value.executionSummary.status).toBe('completed');
      expect(value.executionSummary.durationSeconds).toBe(60);
      expect(value.outputs).toHaveLength(1);
      expect(value.outputs[0]).toMatchObject({
        id: 'r-1',
        type: 'probability',
        format: 'geotiff',
        name: 'Display Name',
        timeOffsetHours: null,
        filePath: null,
        previewUrl: '/api/v1/results/r-1/preview',
        downloadUrl: '/api/v1/results/r-1/download',
      });
      expect(value.inputs).toBeUndefined();
    });
  });
});
