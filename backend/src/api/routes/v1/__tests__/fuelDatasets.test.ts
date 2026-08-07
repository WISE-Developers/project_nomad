/**
 * Tests for GET /api/v1/fuel-datasets (refs #319).
 *
 * Exposes the installed fuel vintages and how a given model year resolves, so
 * the setup and results views can tell the user which fuel their run uses —
 * including when the requested year is not installed and lookup silently falls
 * back to default/.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fuelDatasetsRouter from '../fuelDatasets.js';
import type {
  FuelDataset,
  IFuelDatasetCatalog,
  ResolvedFuelDataset,
} from '../../../../application/interfaces/index.js';

const DATASET_2023: FuelDataset = {
  vintage: 2023,
  edition: '1.0',
  label: 'start-of-2023 fuels; input for 2023 model runs',
  producer: 'Jordan Evens',
  provider: 'NRCan/CFS',
  buildDate: '2022-11-01',
  resolutionM: 100,
};

const DATASET_2026: FuelDataset = { ...DATASET_2023, vintage: 2026, label: 'start-of-2026 fuels' };

function buildApp(catalog: Partial<IFuelDatasetCatalog>) {
  const app = express();
  app.use('/api/v1', fuelDatasetsRouter(catalog as IFuelDatasetCatalog));
  return app;
}

describe('GET /api/v1/fuel-datasets', () => {
  let installed: FuelDataset[];

  beforeEach(() => {
    installed = [DATASET_2023, DATASET_2026];
  });

  it('lists installed vintages with their provenance', async () => {
    const app = buildApp({ listInstalled: async () => installed });

    const res = await request(app).get('/api/v1/fuel-datasets');

    expect(res.status).toBe(200);
    expect(res.body.datasets).toHaveLength(2);
    expect(res.body.datasets[0]).toMatchObject({
      vintage: 2023,
      producer: 'Jordan Evens',
      resolutionM: 100,
    });
  });

  it('returns an empty list, not an error, when no dataset is installed', async () => {
    const app = buildApp({ listInstalled: async () => [] });

    const res = await request(app).get('/api/v1/fuel-datasets');

    expect(res.status).toBe(200);
    expect(res.body.datasets).toEqual([]);
  });

  it('resolves a model year and reports an exact match', async () => {
    const resolved: ResolvedFuelDataset = {
      requestedYear: 2023,
      vintage: 2023,
      matchedRequestedYear: true,
      usedFallback: false,
      dataset: DATASET_2023,
    };
    const app = buildApp({ listInstalled: async () => installed, resolveForYear: async () => resolved });

    const res = await request(app).get('/api/v1/fuel-datasets?modelYear=2023');

    expect(res.status).toBe(200);
    expect(res.body.resolved).toMatchObject({
      requestedYear: 2023,
      vintage: 2023,
      matchedRequestedYear: true,
      usedFallback: false,
    });
  });

  it('surfaces a silent default/ fallback so the UI can warn about it', async () => {
    const resolved: ResolvedFuelDataset = {
      requestedYear: 2023,
      vintage: 2026,
      matchedRequestedYear: false,
      usedFallback: true,
      dataset: DATASET_2026,
    };
    const app = buildApp({ listInstalled: async () => installed, resolveForYear: async () => resolved });

    const res = await request(app).get('/api/v1/fuel-datasets?modelYear=2023');

    expect(res.body.resolved.usedFallback).toBe(true);
    expect(res.body.resolved.matchedRequestedYear).toBe(false);
  });

  it('omits resolution when no modelYear is asked for', async () => {
    const app = buildApp({ listInstalled: async () => installed });

    const res = await request(app).get('/api/v1/fuel-datasets');

    expect(res.body.resolved).toBeUndefined();
  });

  it('rejects a non-numeric modelYear rather than silently ignoring it', async () => {
    const app = buildApp({ listInstalled: async () => installed });

    const res = await request(app).get('/api/v1/fuel-datasets?modelYear=banana');

    expect(res.status).toBe(400);
  });
});
