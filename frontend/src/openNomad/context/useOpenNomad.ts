/**
 * useOpenNomad hooks — access the openNomad API from the nearest
 * OpenNomadProvider.
 *
 * Split out of OpenNomadProvider.tsx so that file exports only the
 * component (react-refresh/only-export-components).
 *
 * @module openNomad/context
 */

import { useContext } from 'react';
import { OpenNomadContext } from './OpenNomadContext.js';
import type { IOpenNomadAPI } from '../api.js';

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
