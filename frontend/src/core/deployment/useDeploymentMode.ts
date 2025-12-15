/**
 * Deployment Mode Hooks
 *
 * React hooks for accessing deployment mode in components.
 */

import { useContext } from 'react';
import { DeploymentModeContext, DeploymentMode, DeploymentModeState } from './DeploymentModeContext';

/**
 * Hook to access the full deployment mode state.
 *
 * @returns Deployment mode state including loading and error status
 * @throws Error if used outside DeploymentModeProvider
 */
export function useDeploymentMode(): DeploymentModeState {
  const context = useContext(DeploymentModeContext);
  if (!context) {
    throw new Error('useDeploymentMode must be used within a DeploymentModeProvider');
  }
  return context;
}

/**
 * Hook to check if running in SAN (Stand Alone Nomad) mode.
 *
 * @returns True if in SAN mode
 */
export function useIsSAN(): boolean {
  const { mode } = useDeploymentMode();
  return mode === 'SAN';
}

/**
 * Hook to check if running in ACN (Agency Centric Nomad) mode.
 *
 * @returns True if in ACN mode
 */
export function useIsACN(): boolean {
  const { mode } = useDeploymentMode();
  return mode === 'ACN';
}

/**
 * Helper function to check deployment mode (for non-React code).
 * Note: This is a synchronous check - use only after mode is loaded.
 */
export function isSAN(mode: DeploymentMode): boolean {
  return mode === 'SAN';
}

/**
 * Helper function to check deployment mode (for non-React code).
 * Note: This is a synchronous check - use only after mode is loaded.
 */
export function isACN(mode: DeploymentMode): boolean {
  return mode === 'ACN';
}
