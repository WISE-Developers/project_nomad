/**
 * Deployment Mode Context — the context object and its types.
 *
 * Separate from DeploymentModeProvider.tsx so that the provider file exports
 * nothing but a component. Vite's fast refresh can only hot-swap a module
 * whose exports are all components; a context object alongside them forces a
 * full reload and tears down state on every edit.
 */

import { createContext } from 'react';

export type DeploymentMode = 'SAN' | 'ACN';

export interface DeploymentModeState {
  mode: DeploymentMode;
  isLoading: boolean;
  error: string | null;
}

export const DeploymentModeContext = createContext<DeploymentModeState | null>(null);
