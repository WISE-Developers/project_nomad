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

import { createContext, useContext, ReactNode, useMemo } from 'react';
import type { IOpenNomadAPI } from '../api.js';

/**
 * Context holding the openNomad API adapter.
 *
 * Null when no provider is present - useOpenNomad() will throw in this case.
 */
const OpenNomadContext = createContext<IOpenNomadAPI | null>(null);

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

/**
 * Hook to access the openNomad API.
 *
 * Returns the API adapter provided by the nearest OpenNomadProvider.
 * Throws if used outside of a provider.
 *
 * @returns The openNomad API interface
 * @throws Error if used outside of OpenNomadProvider
 *
 * @example Basic Usage
 * ```tsx
 * function ModelsList() {
 *   const api = useOpenNomad();
 *   const [models, setModels] = useState<Model[]>([]);
 *
 *   useEffect(() => {
 *     api.models.list().then(response => {
 *       setModels(response.data);
 *     });
 *   }, [api]);
 *
 *   return <ul>{models.map(m => <li key={m.id}>{m.name}</li>)}</ul>;
 * }
 * ```
 *
 * @example With Job Monitoring
 * ```tsx
 * function JobMonitor({ jobId }: { jobId: string }) {
 *   const api = useOpenNomad();
 *   const [status, setStatus] = useState<JobStatusDetail | null>(null);
 *
 *   useEffect(() => {
 *     // Subscribe to job status changes
 *     const unsubscribe = api.jobs.onStatusChange(jobId, (newStatus) => {
 *       setStatus(newStatus);
 *       if (newStatus.status === 'completed' || newStatus.status === 'failed') {
 *         unsubscribe();
 *       }
 *     });
 *
 *     return unsubscribe;
 *   }, [api, jobId]);
 *
 *   return <div>Status: {status?.status ?? 'Loading...'}</div>;
 * }
 * ```
 */
export function useOpenNomad(): IOpenNomadAPI {
  const context = useContext(OpenNomadContext);

  if (!context) {
    throw new Error(
      'useOpenNomad must be used within an OpenNomadProvider. ' +
      'Wrap your component tree with <OpenNomadProvider adapter={...}>.'
    );
  }

  return context;
}

/**
 * Hook to check if openNomad API is available.
 *
 * Unlike useOpenNomad(), this doesn't throw if no provider exists.
 * Useful for components that can work with or without the API.
 *
 * @returns The API if available, null otherwise
 *
 * @example
 * ```tsx
 * function OptionalApiConsumer() {
 *   const api = useOpenNomadOptional();
 *
 *   if (!api) {
 *     return <div>API not available</div>;
 *   }
 *
 *   return <div>API available</div>;
 * }
 * ```
 */
export function useOpenNomadOptional(): IOpenNomadAPI | null {
  return useContext(OpenNomadContext);
}
