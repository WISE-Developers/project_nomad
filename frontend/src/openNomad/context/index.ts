/**
 * OpenNomad Context Module
 *
 * Provides React context for the openNomad API.
 *
 * @module openNomad/context
 */

export {
  OpenNomadProvider,
  type OpenNomadProviderProps,
} from './OpenNomadProvider.js';
export { useOpenNomad, useOpenNomadOptional } from './useOpenNomad.js';
