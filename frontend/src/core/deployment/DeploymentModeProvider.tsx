/**
 * Deployment Mode Provider
 *
 * Fetches the deployment mode from the backend health endpoint on mount and
 * publishes it through DeploymentModeContext.
 */

import { useState, useEffect, ReactNode } from 'react';

import {
  DeploymentModeContext,
  type DeploymentMode,
  type DeploymentModeState,
} from './DeploymentModeContext';

interface DeploymentModeProviderProps {
  children: ReactNode;
}

/**
 * Provider component that fetches deployment mode from backend on mount.
 * Until the mode is fetched, isLoading is true and mode defaults to 'SAN'.
 */
export function DeploymentModeProvider({ children }: DeploymentModeProviderProps) {
  const [state, setState] = useState<DeploymentModeState>({
    mode: 'SAN',
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    async function fetchDeploymentMode() {
      try {
        const response = await fetch('/api/v1/health');
        if (!response.ok) {
          throw new Error(`Health check failed: ${response.statusText}`);
        }
        const data = await response.json();
        const mode = (data.deploymentMode as DeploymentMode) || 'SAN';

        setState({
          mode,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        console.error('Failed to fetch deployment mode:', err);
        setState({
          mode: 'SAN', // Default to SAN on error
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to fetch deployment mode',
        });
      }
    }

    fetchDeploymentMode();
  }, []);

  return (
    <DeploymentModeContext.Provider value={state}>
      {children}
    </DeploymentModeContext.Provider>
  );
}
