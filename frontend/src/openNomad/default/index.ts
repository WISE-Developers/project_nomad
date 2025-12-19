/**
 * Default openNomad API Implementation
 *
 * This module provides the default adapter for SAN (Stand Alone Nomad) mode.
 * It wraps the Nomad backend API and serves as a template for agency adapters.
 *
 * ## Usage
 *
 * ```tsx
 * import { createDefaultAdapter } from '@/openNomad/default';
 * import { OpenNomadProvider } from '@/openNomad/context';
 *
 * function App() {
 *   const adapter = useMemo(() => createDefaultAdapter(), []);
 *
 *   return (
 *     <OpenNomadProvider adapter={adapter}>
 *       <YourApp />
 *     </OpenNomadProvider>
 *   );
 * }
 * ```
 *
 * ## For Agency Implementers
 *
 * See DefaultOpenNomadAPI.ts for heavily-commented implementation that
 * serves as a template for creating agency-specific adapters.
 *
 * @module openNomad/default
 */

export {
  createDefaultAdapter,
  type DefaultAdapterOptions,
} from './DefaultOpenNomadAPI.js';
