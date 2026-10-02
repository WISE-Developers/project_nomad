/**
 * Deployment Mode Module
 *
 * Provides deployment mode awareness for the frontend application.
 * The deployment mode (SAN or ACN) determines which features and
 * services are available in the application.
 */

export { DeploymentModeContext } from './DeploymentModeContext';
export { DeploymentModeProvider } from './DeploymentModeProvider';
export type { DeploymentMode, DeploymentModeState } from './DeploymentModeContext';
export { useDeploymentMode, useIsSAN, useIsACN, isSAN, isACN } from './useDeploymentMode';
