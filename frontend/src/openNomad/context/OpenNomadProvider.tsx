/**
 * OpenNomad Context
 *
 * Provides the openNomad API to child components. The Dashboard and other
 * components use this context to communicate with backend services.
 *
 * ## Architecture
 *
 * The context accepts an adapter implementing IOpenNomadAPI. This enables:
 * - **SAN mode**: Uses DefaultOpenNomadAPI (wraps Nomad backend)
 * - **ACN mode**: Uses agency-specific adapter (e.g., openNomad-NWT)
 *
 * ## For Agency Implementers
 *
 * To create a custom adapter:
 * 1. Implement the IOpenNomadAPI interface (see /openNomad/api.ts)
 * 2. Create your adapter in a separate repo (e.g., openNomad-{agency})
 * 3. Provide it to OpenNomadProvider in your host application
 *
 * @module openNomad/context
 */

import { ReactNode, useMemo } from 'react';
import type { IOpenNomadAPI } from '../api.js';
import { OpenNomadContext } from './OpenNomadContext.js';

/**
 * Props for OpenNomadProvider
 */
export interface OpenNomadProviderProps {
  /**
   * The openNomad API adapter to use.
   *
   * - For SAN mode: Use createDefaultAdapter() from /openNomad/default
   * - For ACN mode: Use your agency-specific adapter
   */
  adapter: IOpenNomadAPI;

  /**
   * Child components that will have access to the API
   */
  children: ReactNode;
}

/**
 * Provides the openNomad API to child components.
 *
 * Wrap your application (or the Dashboard component) with this provider
 * to enable API access via the useOpenNomad() hook.
 *
 * @example SAN Mode (Nomad App)
 * ```tsx
 * import { OpenNomadProvider } from '@/openNomad/context';
 * import { createDefaultAdapter } from '@/openNomad/default';
 *
 * function App() {
 *   const adapter = useMemo(() => createDefaultAdapter(), []);
 *
 *   return (
 *     <OpenNomadProvider adapter={adapter}>
 *       <Dashboard />
 *     </OpenNomadProvider>
 *   );
 * }
 * ```
 *
 * @example ACN Mode (Agency Host)
 * ```tsx
 * import { OpenNomadProvider, Dashboard } from '@nomad/dashboard';
 * import { createNwtAdapter } from '@nomad/openNomad-nwt';
 *
 * function AgencyApp() {
 *   const agencyAuth = useAgencyAuth();
 *   const adapter = useMemo(
 *     () => createNwtAdapter({ authContext: agencyAuth }),
 *     [agencyAuth]
 *   );
 *
 *   return (
 *     <OpenNomadProvider adapter={adapter}>
 *       <Dashboard embedded={true} />
 *     </OpenNomadProvider>
 *   );
 * }
 * ```
 */
export function OpenNomadProvider({ adapter, children }: OpenNomadProviderProps) {
  // Memoize to prevent unnecessary re-renders if parent re-renders
  // The adapter instance should be stable (created with useMemo in parent)
  const value = useMemo(() => adapter, [adapter]);

  return (
    <OpenNomadContext.Provider value={value}>
      {children}
    </OpenNomadContext.Provider>
  );
}
