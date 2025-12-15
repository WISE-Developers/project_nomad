/**
 * Health & Info Endpoint Regression Tests
 *
 * Ensures health and info endpoints maintain their contract
 * as we extend deployment mode support.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import healthRouter from '../routes/v1/health.js';

describe('Health Endpoints', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1', healthRouter);
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 status', async () => {
      const response = await request(app).get('/api/v1/health');
      expect(response.status).toBe(200);
    });

    it('returns status field', async () => {
      const response = await request(app).get('/api/v1/health');
      expect(response.body.status).toBeDefined();
      expect(['healthy', 'unhealthy']).toContain(response.body.status);
    });

    it('returns timestamp in ISO format', async () => {
      const response = await request(app).get('/api/v1/health');
      expect(response.body.timestamp).toBeDefined();
      expect(() => new Date(response.body.timestamp)).not.toThrow();
    });

    it('returns uptime as number', async () => {
      const response = await request(app).get('/api/v1/health');
      expect(response.body.uptime).toBeDefined();
      expect(typeof response.body.uptime).toBe('number');
      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('returns deploymentMode field', async () => {
      const response = await request(app).get('/api/v1/health');
      expect(response.body.deploymentMode).toBeDefined();
      expect(['SAN', 'ACN']).toContain(response.body.deploymentMode);
    });

    it('returns checks object with expected structure', async () => {
      const response = await request(app).get('/api/v1/health');
      expect(response.body.checks).toBeDefined();
      expect(response.body.checks.database).toBeDefined();
      expect(response.body.checks.engines).toBeDefined();
    });

    it('returns engine availability info', async () => {
      const response = await request(app).get('/api/v1/health');
      const engines = response.body.checks.engines;
      expect(engines.FireSTARR).toBeDefined();
      expect(engines.WISE).toBeDefined();
      expect(typeof engines.FireSTARR.available).toBe('boolean');
      expect(typeof engines.WISE.available).toBe('boolean');
    });
  });

  describe('GET /api/v1/info', () => {
    it('returns 200 status', async () => {
      const response = await request(app).get('/api/v1/info');
      expect(response.status).toBe(200);
    });

    it('returns name field', async () => {
      const response = await request(app).get('/api/v1/info');
      expect(response.body.name).toBeDefined();
      expect(response.body.name).toBe('Project Nomad');
    });

    it('returns version field', async () => {
      const response = await request(app).get('/api/v1/info');
      expect(response.body.version).toBeDefined();
      expect(typeof response.body.version).toBe('string');
    });

    it('returns environment field', async () => {
      const response = await request(app).get('/api/v1/info');
      expect(response.body.environment).toBeDefined();
      expect(['development', 'staging', 'production', 'test']).toContain(
        response.body.environment
      );
    });

    it('returns deploymentMode field', async () => {
      const response = await request(app).get('/api/v1/info');
      expect(response.body.deploymentMode).toBeDefined();
      expect(['SAN', 'ACN']).toContain(response.body.deploymentMode);
    });

    it('returns capabilities object', async () => {
      const response = await request(app).get('/api/v1/info');
      expect(response.body.capabilities).toBeDefined();
      expect(response.body.capabilities.engines).toBeDefined();
      expect(Array.isArray(response.body.capabilities.engines)).toBe(true);
      expect(response.body.capabilities.maxJobDuration).toBeDefined();
    });

    it('includes expected engines in capabilities', async () => {
      const response = await request(app).get('/api/v1/info');
      const engines = response.body.capabilities.engines;
      expect(engines).toContain('FireSTARR');
      expect(engines).toContain('WISE');
    });
  });
});
