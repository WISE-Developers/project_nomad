/**
 * Engine Resolver
 *
 * Resolves an {@link IFireModelingEngine} for a given {@link EngineType} via a
 * registry, so callers depend on the abstraction rather than importing a
 * concrete engine factory. Adding a new engine means registering a factory
 * here — no caller code changes (Open/Closed).
 */

import { EngineType } from '../../domain/entities/index.js';
import { EngineError } from '../../domain/errors/index.js';
import type { IFireModelingEngine } from '../../application/interfaces/IFireModelingEngine.js';
import { getFireSTARREngine } from '../firestarr/index.js';

/** A factory that produces a fire-modeling engine implementation. */
type EngineFactory = () => IFireModelingEngine;

/**
 * Registry of engine factories keyed by engine type.
 * Register additional engines here; callers are untouched.
 */
const ENGINE_REGISTRY: Partial<Record<EngineType, EngineFactory>> = {
  [EngineType.FireSTARR]: getFireSTARREngine,
};

/**
 * Resolve the engine implementation for the given engine type.
 *
 * @throws EngineError if no engine is registered for the type (fail-fast —
 *   a missing engine is a configuration error, not a silent default).
 */
export function getEngine(engineType: EngineType): IFireModelingEngine {
  const factory = ENGINE_REGISTRY[engineType];
  if (!factory) {
    throw EngineError.unavailable(engineType, `No engine registered for type: ${engineType}`);
  }
  return factory();
}
