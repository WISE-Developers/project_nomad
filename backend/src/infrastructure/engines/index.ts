/**
 * Engines Infrastructure
 *
 * Engine resolution: maps an EngineType to its IFireModelingEngine
 * implementation so callers depend on the abstraction, not a concrete factory.
 */

export { getEngine } from './EngineResolver.js';
