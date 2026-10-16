import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { find, findById, getResults } = vi.hoisted(() => ({
  find: vi.fn(),
  findById: vi.fn(),
  getResults: vi.fn(),
}));

vi.mock('../../../../infrastructure/database/index.js', () => ({
  getModelRepository: vi.fn(() => ({ find, findById })),
  getResultRepository: vi.fn(() => ({
    findByModelId: vi.fn(async () => []),
  })),
}));

vi.mock('../../../../infrastructure/engines/index.js', () => ({
  getEngine: vi.fn(() => ({})),
  getWorkspaceAwareEngine: vi.fn(() => ({
    getWorkingDirectory: vi.fn(() => null),
  })),
}));

vi.mock('../../../../infrastructure/firestarr/index.js', () => ({
  generateArrivalTile: vi.fn(),
  findArrivalTifs: vi.fn(),
  getRasterBounds: vi.fn(),
}));

vi.mock('../../../../infrastructure/services/index.js', () => ({
  getModelExecutionService: vi.fn(),
}));

vi.mock('../../../../infrastructure/services/JobQueue.js', () => ({
  getJobQueue: vi.fn(),
}));

vi.mock('../../../../application/services/index.js', () => ({
  getModelResultsService: vi.fn(() => ({ getResults })),
}));

vi.mock('../../../../application/services/finalizeModelExecution.js', () => ({
  finalizeModelExecution: vi.fn(),
}));

import modelsRouter from '../models.js';
import { errorHandler } from '../../../middleware/errorHandler.js';
import { createFireModelId, EngineType, FireModel, ModelStatus } from '../../../../domain/entities/index.js';

const model = new FireModel({
  id: createFireModelId('model-owner'),
  name: 'Owned model',
  engineType: EngineType.FireSTARR,
  status: ModelStatus.Draft,
  createdAt: new Date('2026-06-15T00:00:00Z'),
  updatedAt: new Date('2026-06-15T00:00:00Z'),
  userId: 'Keycloak user (owner-1)',
});

function buildApp(id: string, name: string, displayName: string) {
  const app = express();
  app.use((req, _res, next) => {
    req.acn = {
      agency: { id: 'alberta', keyPrefix: 'test' },
      user: { id, name, displayName, role: 'admin' },
    };
    next();
  });
  app.use('/api/v1', modelsRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  find.mockReset();
  find.mockResolvedValue({ models: [model], totalCount: 1 });
  findById.mockReset();
  findById.mockResolvedValue(model);
  getResults.mockReset();
  getResults.mockResolvedValue({
    success: true,
    value: {
      modelId: 'model-owner',
      modelName: 'Owned model',
      engineType: 'firestarr',
      userId: model.userId,
      notes: null,
      executionSummary: {
        startedAt: null,
        completedAt: null,
        durationSeconds: null,
        status: 'running',
        progress: 0,
      },
      outputs: [],
    },
  });
});

describe('GET /models owner display name', () => {
  it('returns a friendly value to the owner, not to other users, without changing userId', async () => {
    const owner = await request(
      buildApp('owner-1', 'Keycloak user', 'owner@example.test')
    )
      .get('/api/v1/models')
      .expect(200);

    expect(owner.body.models[0]).toMatchObject({
      userId: 'Keycloak user (owner-1)',
      userDisplayName: 'owner@example.test',
    });

    const ownerDetails = await request(
      buildApp('owner-1', 'Keycloak user', 'owner@example.test')
    )
      .get('/api/v1/models/model-owner')
      .expect(200);

    expect(ownerDetails.body).toMatchObject({
      userId: 'Keycloak user (owner-1)',
      userDisplayName: 'owner@example.test',
    });

    const otherUser = await request(
      buildApp('other-2', 'Other user', 'other@example.test')
    )
      .get('/api/v1/models')
      .expect(200);

    expect(otherUser.body.models[0]).toMatchObject({
      userId: 'Keycloak user (owner-1)',
      userDisplayName: null,
    });

    const otherDetails = await request(
      buildApp('other-2', 'Other user', 'other@example.test')
    )
      .get('/api/v1/models/model-owner')
      .expect(200);

    expect(otherDetails.body).toMatchObject({
      userId: 'Keycloak user (owner-1)',
      userDisplayName: null,
    });

    const ownerResults = await request(
      buildApp('owner-1', 'Keycloak user', 'owner@example.test')
    )
      .get('/api/v1/models/model-owner/results')
      .expect(200);

    expect(ownerResults.body).toMatchObject({
      userId: 'Keycloak user (owner-1)',
      userDisplayName: 'owner@example.test',
    });

    const otherResults = await request(
      buildApp('other-2', 'Other user', 'other@example.test')
    )
      .get('/api/v1/models/model-owner/results')
      .expect(200);

    expect(otherResults.body).toMatchObject({
      userId: 'Keycloak user (owner-1)',
      userDisplayName: null,
    });
  });
});
