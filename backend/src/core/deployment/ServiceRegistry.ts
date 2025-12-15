/**
 * Service Registry
 *
 * Maps service types to their SAN and ACN implementations.
 * Used by ServiceFactory to resolve the correct implementation
 * based on deployment mode.
 */

import { DeploymentMode } from '../../application/interfaces/index.js';

/**
 * Service factory function type
 */
export type ServiceFactoryFn<T> = () => T;

/**
 * Registration entry for a service with mode-specific implementations
 */
export interface ServiceRegistration<T> {
  /** Factory for SAN mode implementation */
  san: ServiceFactoryFn<T>;
  /** Factory for ACN mode implementation (optional, falls back to SAN) */
  acn?: ServiceFactoryFn<T>;
}

/**
 * Service identifier type (string literal)
 */
export type ServiceId = string;

/**
 * Registry for service implementations.
 *
 * This registry maintains mappings between service IDs and their
 * mode-specific factory functions. Services are registered once
 * at application startup and resolved based on deployment mode.
 */
export class ServiceRegistry {
  private registrations = new Map<ServiceId, ServiceRegistration<unknown>>();

  /**
   * Registers a service with mode-specific implementations.
   *
   * @param id - Unique service identifier
   * @param registration - Factory functions for SAN and optionally ACN modes
   */
  register<T>(id: ServiceId, registration: ServiceRegistration<T>): void {
    if (this.registrations.has(id)) {
      throw new Error(`Service '${id}' is already registered`);
    }
    this.registrations.set(id, registration as ServiceRegistration<unknown>);
  }

  /**
   * Gets the factory function for a service in the given mode.
   *
   * @param id - Service identifier
   * @param mode - Deployment mode
   * @returns Factory function for the appropriate implementation
   */
  getFactory<T>(id: ServiceId, mode: DeploymentMode): ServiceFactoryFn<T> | undefined {
    const registration = this.registrations.get(id) as ServiceRegistration<T> | undefined;
    if (!registration) {
      return undefined;
    }

    // ACN mode: use ACN implementation if available, otherwise fall back to SAN
    if (mode === 'ACN' && registration.acn) {
      return registration.acn;
    }

    return registration.san;
  }

  /**
   * Checks if a service is registered.
   *
   * @param id - Service identifier
   */
  has(id: ServiceId): boolean {
    return this.registrations.has(id);
  }

  /**
   * Gets all registered service IDs.
   */
  getServiceIds(): ServiceId[] {
    return Array.from(this.registrations.keys());
  }

  /**
   * Clears all registrations (for testing).
   */
  clear(): void {
    this.registrations.clear();
  }
}

/**
 * Global service registry instance
 */
export const globalRegistry = new ServiceRegistry();

/**
 * Well-known service identifiers
 */
export const ServiceIds = {
  AUTH: 'auth',
  CONFIGURATION: 'configuration',
  MODEL_REPOSITORY: 'modelRepository',
  SPATIAL_REPOSITORY: 'spatialRepository',
  JOB_REPOSITORY: 'jobRepository',
  RESULT_REPOSITORY: 'resultRepository',
  WEATHER_REPOSITORY: 'weatherRepository',
} as const;

export type KnownServiceId = (typeof ServiceIds)[keyof typeof ServiceIds];
