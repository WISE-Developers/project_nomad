/**
 * Deployment Mode Tests
 *
 * Tests for deployment mode detection and validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvironmentService } from '../../../infrastructure/config/EnvironmentService.js';

describe('DeploymentMode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    EnvironmentService.resetInstance();
  });

  afterEach(() => {
    process.env = originalEnv;
    EnvironmentService.resetInstance();
  });

  describe('getDeploymentMode', () => {
    it('defaults to SAN when env var not set', () => {
      delete process.env.NOMAD_DEPLOYMENT_MODE;
      const service = EnvironmentService.getInstance();

      expect(service.getDeploymentMode()).toBe('SAN');
    });

    it('returns SAN when explicitly set to SAN', () => {
      process.env.NOMAD_DEPLOYMENT_MODE = 'SAN';
      const service = EnvironmentService.getInstance();

      expect(service.getDeploymentMode()).toBe('SAN');
    });

    it('returns ACN when set to ACN', () => {
      process.env.NOMAD_DEPLOYMENT_MODE = 'ACN';
      const service = EnvironmentService.getInstance();

      expect(service.getDeploymentMode()).toBe('ACN');
    });

    it('is case insensitive (lowercase acn)', () => {
      process.env.NOMAD_DEPLOYMENT_MODE = 'acn';
      const service = EnvironmentService.getInstance();

      expect(service.getDeploymentMode()).toBe('ACN');
    });

    it('is case insensitive (mixed case Acn)', () => {
      process.env.NOMAD_DEPLOYMENT_MODE = 'Acn';
      const service = EnvironmentService.getInstance();

      expect(service.getDeploymentMode()).toBe('ACN');
    });

    it('throws descriptive error for invalid mode', () => {
      process.env.NOMAD_DEPLOYMENT_MODE = 'INVALID';
      const service = EnvironmentService.getInstance();

      expect(() => service.getDeploymentMode()).toThrowError(
        /Invalid NOMAD_DEPLOYMENT_MODE: "INVALID"/
      );
    });

    it('throws descriptive error with guidance', () => {
      process.env.NOMAD_DEPLOYMENT_MODE = 'standalone';
      const service = EnvironmentService.getInstance();

      expect(() => service.getDeploymentMode()).toThrowError(
        /Must be "SAN" or "ACN"/
      );
    });
  });

  describe('getAgencyId', () => {
    it('returns undefined when not set', () => {
      delete process.env.NOMAD_AGENCY_ID;
      const service = EnvironmentService.getInstance();

      expect(service.getAgencyId()).toBeUndefined();
    });

    it('returns agency ID when set', () => {
      process.env.NOMAD_AGENCY_ID = 'nwt';
      const service = EnvironmentService.getInstance();

      expect(service.getAgencyId()).toBe('nwt');
    });
  });
});
