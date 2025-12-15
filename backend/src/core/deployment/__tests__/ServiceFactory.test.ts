/**
 * Service Factory Tests
 *
 * Tests for mode-aware service resolution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServiceFactory } from '../ServiceFactory.js';
import { ServiceRegistry } from '../ServiceRegistry.js';
import { IEnvironmentService } from '../../../application/interfaces/index.js';

// Mock environment service
function createMockEnvService(mode: 'SAN' | 'ACN'): IEnvironmentService {
  return {
    getDeploymentMode: () => mode,
    getAgencyId: () => undefined,
    get: () => undefined,
    getRequired: () => '',
    getOrDefault: (key: string, def: string) => def,
    isProduction: () => false,
    isDevelopment: () => true,
    isTest: () => false,
    getNodeEnv: () => 'test',
  };
}

describe('ServiceFactory', () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry();
    ServiceFactory.resetInstance();
  });

  afterEach(() => {
    ServiceFactory.resetInstance();
  });

  describe('deployment mode', () => {
    it('reports SAN mode correctly', () => {
      const envService = createMockEnvService('SAN');
      const factory = new ServiceFactory(envService, registry);

      expect(factory.getDeploymentMode()).toBe('SAN');
      expect(factory.isSAN()).toBe(true);
      expect(factory.isACN()).toBe(false);
    });

    it('reports ACN mode correctly', () => {
      const envService = createMockEnvService('ACN');
      const factory = new ServiceFactory(envService, registry);

      expect(factory.getDeploymentMode()).toBe('ACN');
      expect(factory.isSAN()).toBe(false);
      expect(factory.isACN()).toBe(true);
    });
  });

  describe('service resolution', () => {
    it('returns SAN implementation in SAN mode', () => {
      const sanImpl = { type: 'SAN' };
      const acnImpl = { type: 'ACN' };

      registry.register('test-service', {
        san: () => sanImpl,
        acn: () => acnImpl,
      });

      const envService = createMockEnvService('SAN');
      const factory = new ServiceFactory(envService, registry);

      const result = factory.get<{ type: string }>('test-service');
      expect(result.type).toBe('SAN');
    });

    it('returns ACN implementation in ACN mode when available', () => {
      const sanImpl = { type: 'SAN' };
      const acnImpl = { type: 'ACN' };

      registry.register('test-service', {
        san: () => sanImpl,
        acn: () => acnImpl,
      });

      const envService = createMockEnvService('ACN');
      const factory = new ServiceFactory(envService, registry);

      const result = factory.get<{ type: string }>('test-service');
      expect(result.type).toBe('ACN');
    });

    it('falls back to SAN implementation in ACN mode when ACN not available', () => {
      const sanImpl = { type: 'SAN-only' };

      registry.register('san-only-service', {
        san: () => sanImpl,
        // No ACN implementation
      });

      const envService = createMockEnvService('ACN');
      const factory = new ServiceFactory(envService, registry);

      const result = factory.get<{ type: string }>('san-only-service');
      expect(result.type).toBe('SAN-only');
    });

    it('throws error for unregistered service', () => {
      const envService = createMockEnvService('SAN');
      const factory = new ServiceFactory(envService, registry);

      expect(() => factory.get('unknown-service')).toThrowError(
        /Service 'unknown-service' is not registered/
      );
    });
  });

  describe('lazy initialization', () => {
    it('only creates service instance on first get', () => {
      const factoryFn = vi.fn(() => ({ id: 'test' }));

      registry.register('lazy-service', {
        san: factoryFn,
      });

      const envService = createMockEnvService('SAN');
      const factory = new ServiceFactory(envService, registry);

      // Not called yet
      expect(factoryFn).not.toHaveBeenCalled();

      // First call
      factory.get('lazy-service');
      expect(factoryFn).toHaveBeenCalledTimes(1);

      // Second call - cached
      factory.get('lazy-service');
      expect(factoryFn).toHaveBeenCalledTimes(1);
    });

    it('returns same instance on subsequent calls', () => {
      registry.register('singleton-service', {
        san: () => ({ timestamp: Date.now() }),
      });

      const envService = createMockEnvService('SAN');
      const factory = new ServiceFactory(envService, registry);

      const first = factory.get('singleton-service');
      const second = factory.get('singleton-service');

      expect(first).toBe(second);
    });
  });

  describe('cache management', () => {
    it('clearCache removes all cached instances', () => {
      const factoryFn = vi.fn(() => ({ id: 'test' }));

      registry.register('cached-service', {
        san: factoryFn,
      });

      const envService = createMockEnvService('SAN');
      const factory = new ServiceFactory(envService, registry);

      factory.get('cached-service');
      expect(factoryFn).toHaveBeenCalledTimes(1);

      factory.clearCache();

      factory.get('cached-service');
      expect(factoryFn).toHaveBeenCalledTimes(2);
    });

    it('getCachedServiceIds returns correct IDs', () => {
      registry.register('service-a', { san: () => ({}) });
      registry.register('service-b', { san: () => ({}) });

      const envService = createMockEnvService('SAN');
      const factory = new ServiceFactory(envService, registry);

      expect(factory.getCachedServiceIds()).toEqual([]);

      factory.get('service-a');
      expect(factory.getCachedServiceIds()).toEqual(['service-a']);

      factory.get('service-b');
      expect(factory.getCachedServiceIds()).toEqual(['service-a', 'service-b']);
    });
  });
});

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry();
  });

  it('prevents duplicate registration', () => {
    registry.register('dup-service', { san: () => ({}) });

    expect(() =>
      registry.register('dup-service', { san: () => ({}) })
    ).toThrowError(/already registered/);
  });

  it('reports registered services correctly', () => {
    registry.register('service-1', { san: () => ({}) });
    registry.register('service-2', { san: () => ({}) });

    expect(registry.has('service-1')).toBe(true);
    expect(registry.has('service-2')).toBe(true);
    expect(registry.has('service-3')).toBe(false);
  });

  it('returns all service IDs', () => {
    registry.register('alpha', { san: () => ({}) });
    registry.register('beta', { san: () => ({}) });

    const ids = registry.getServiceIds();
    expect(ids).toContain('alpha');
    expect(ids).toContain('beta');
    expect(ids.length).toBe(2);
  });
});
