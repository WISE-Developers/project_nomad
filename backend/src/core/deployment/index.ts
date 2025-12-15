/**
 * Core Deployment Module
 *
 * Provides deployment mode awareness and mode-specific service resolution.
 * This module is the foundation for supporting both SAN (Stand Alone Nomad)
 * and ACN (Agency Centric Nomad) deployment modes.
 */

export {
  ServiceRegistry,
  globalRegistry,
  ServiceIds,
  type ServiceId,
  type KnownServiceId,
  type ServiceFactoryFn,
  type ServiceRegistration,
} from './ServiceRegistry.js';

export {
  ServiceFactory,
  getService,
} from './ServiceFactory.js';
