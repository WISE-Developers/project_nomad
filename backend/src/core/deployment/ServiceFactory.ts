/**
 * Service Factory
 *
 * Mode-aware factory for instantiating service implementations.
 * Uses lazy initialization and caches instances for reuse.
 */

import {
  DeploymentMode,
  IEnvironmentService,
} from '../../application/interfaces/index.js';
import {
  ServiceRegistry,
  ServiceId,
  globalRegistry,
} from './ServiceRegistry.js';

/**
 * Mode-aware service factory with lazy initialization.
 *
 * The factory resolves services based on the current deployment mode,
 * caches instances for reuse, and supports both SAN and ACN implementations.
 *
 * Usage:
 * ```typescript
 * const factory = ServiceFactory.getInstance(envService);
 * const authService = factory.get<IAuthService>('auth');
 * ```
 */
export class ServiceFactory {
  private static instance: ServiceFactory | null = null;
  private readonly cache = new Map<ServiceId, unknown>();
  private readonly mode: DeploymentMode;

  constructor(
    envService: IEnvironmentService,
    private readonly registry: ServiceRegistry = globalRegistry
  ) {
    this.mode = envService.getDeploymentMode();
    console.log(`[ServiceFactory] Initialized in ${this.mode} mode`);
  }

  /**
   * Gets the singleton instance of ServiceFactory.
   *
   * @param envService - Environment service for reading deployment mode
   */
  static getInstance(envService: IEnvironmentService): ServiceFactory {
    if (!ServiceFactory.instance) {
      ServiceFactory.instance = new ServiceFactory(envService);
    }
    return ServiceFactory.instance;
  }

  /**
   * Resets the singleton instance (for testing).
   */
  static resetInstance(): void {
    ServiceFactory.instance = null;
  }

  /**
   * Gets the current deployment mode.
   */
  getDeploymentMode(): DeploymentMode {
    return this.mode;
  }

  /**
   * Gets a service instance by ID.
   *
   * Services are lazily instantiated on first request and cached
   * for subsequent calls.
   *
   * @param id - Service identifier
   * @returns Service instance
   * @throws Error if service is not registered
   */
  get<T>(id: ServiceId): T {
    // Check cache first
    if (this.cache.has(id)) {
      return this.cache.get(id) as T;
    }

    // Get factory from registry
    const factory = this.registry.getFactory<T>(id, this.mode);
    if (!factory) {
      throw new Error(
        `Service '${id}' is not registered. ` +
        `Available services: ${this.registry.getServiceIds().join(', ')}`
      );
    }

    // Create instance and cache it
    const instance = factory();
    this.cache.set(id, instance);
    console.log(`[ServiceFactory] Created ${id} service for ${this.mode} mode`);

    return instance;
  }

  /**
   * Checks if a service is available.
   *
   * @param id - Service identifier
   */
  has(id: ServiceId): boolean {
    return this.registry.has(id);
  }

  /**
   * Checks if running in SAN mode.
   */
  isSAN(): boolean {
    return this.mode === 'SAN';
  }

  /**
   * Checks if running in ACN mode.
   */
  isACN(): boolean {
    return this.mode === 'ACN';
  }

  /**
   * Clears the instance cache (for testing or hot reload).
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[ServiceFactory] Cache cleared');
  }

  /**
   * Gets all cached service IDs.
   */
  getCachedServiceIds(): ServiceId[] {
    return Array.from(this.cache.keys());
  }
}

/**
 * Convenience function to get a service from the global factory.
 *
 * @param id - Service identifier
 * @param envService - Environment service (for first initialization)
 */
export function getService<T>(id: ServiceId, envService: IEnvironmentService): T {
  return ServiceFactory.getInstance(envService).get<T>(id);
}
