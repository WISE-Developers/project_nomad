/**
 * Embedded Dashboard Integration Example
 *
 * This file demonstrates how to integrate the Nomad Dashboard
 * into an agency's existing React application in ACN (embedded) mode.
 *
 * Copy and adapt this pattern for your agency's integration.
 *
 * @module openNomad/examples
 */

import React, { useMemo, useCallback, useState } from 'react';
import { OpenNomadProvider } from '../context/OpenNomadContext.js';
import { DashboardContainer } from '../../features/Dashboard/components/DashboardContainer.js';
import { createAgencyAdapter, type AgencyAdapterOptions } from './ExampleAgencyAdapter.js';

// =============================================================================
// Example 1: Basic Embedded Integration
// =============================================================================

/**
 * Props your host application should pass to the embedded dashboard
 */
interface EmbeddedDashboardProps {
  /** Auth token from your identity provider */
  authToken: string;
  /** Your agency's API base URL */
  apiBaseUrl: string;
  /** Your agency identifier */
  agencyId: string;
  /** Called when user wants to start a new model */
  onLaunchWizard?: (draftId?: string) => void;
  /** Called when user wants to view model results */
  onViewResults?: (modelId: string) => void;
  /** Called when user wants to add results to the map */
  onAddToMap?: (modelId: string) => void;
}

/**
 * Example embedded dashboard wrapper.
 *
 * This is what you'd create in your agency's codebase.
 *
 * @example
 * ```tsx
 * // In your agency's React application
 * function FireModelingSection() {
 *   const { authToken } = useAuth(); // Your auth hook
 *
 *   return (
 *     <div style={{ height: '600px' }}>
 *       <EmbeddedNomadDashboard
 *         authToken={authToken}
 *         apiBaseUrl="https://api.your-agency.gov/nomad"
 *         agencyId="your-agency"
 *         onLaunchWizard={(draftId) => navigate(`/modeling/new${draftId ? `?draft=${draftId}` : ''}`)}
 *         onViewResults={(modelId) => navigate(`/modeling/results/${modelId}`)}
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
export function EmbeddedNomadDashboard({
  authToken,
  apiBaseUrl,
  agencyId,
  onLaunchWizard,
  onViewResults,
  onAddToMap,
}: EmbeddedDashboardProps) {
  // Create the adapter with agency configuration
  // useMemo ensures we don't recreate on every render
  const adapter = useMemo(() => {
    const options: AgencyAdapterOptions = {
      authToken,
      apiBaseUrl,
      agencyId,
    };
    return createAgencyAdapter(options);
  }, [authToken, apiBaseUrl, agencyId]);

  return (
    <OpenNomadProvider adapter={adapter}>
      <DashboardContainer
        mode="embedded"
        onLaunchWizard={onLaunchWizard}
        onViewResults={onViewResults}
        onAddToMap={onAddToMap}
        initialTab="models"
      />
    </OpenNomadProvider>
  );
}

// =============================================================================
// Example 2: With Custom Styling
// =============================================================================

interface StyledEmbeddedDashboardProps extends EmbeddedDashboardProps {
  /** Custom CSS class */
  className?: string;
  /** Custom height (default: 100%) */
  height?: string | number;
}

/**
 * Embedded dashboard with custom styling support.
 *
 * @example
 * ```tsx
 * <StyledEmbeddedDashboard
 *   authToken={token}
 *   apiBaseUrl="/api/nomad"
 *   agencyId="nwt"
 *   className="agency-dashboard-panel"
 *   height="800px"
 * />
 * ```
 */
export function StyledEmbeddedDashboard({
  className,
  height = '100%',
  ...props
}: StyledEmbeddedDashboardProps) {
  const containerStyle: React.CSSProperties = {
    height,
    minHeight: '400px',
    display: 'flex',
    flexDirection: 'column',
  };

  return (
    <div style={containerStyle} className={className}>
      <EmbeddedNomadDashboard {...props} />
    </div>
  );
}

// =============================================================================
// Example 3: With Token Refresh Handling
// =============================================================================

interface TokenRefreshDashboardProps extends Omit<EmbeddedDashboardProps, 'authToken'> {
  /** Function that returns current auth token */
  getAuthToken: () => string | Promise<string>;
  /** Called when token needs refresh */
  onTokenRefresh?: () => Promise<string>;
}

/**
 * Dashboard with automatic token refresh support.
 *
 * Use this pattern if your auth tokens expire and need refresh.
 *
 * @example
 * ```tsx
 * <TokenRefreshDashboard
 *   getAuthToken={() => authService.getToken()}
 *   onTokenRefresh={async () => {
 *     await authService.refresh();
 *     return authService.getToken();
 *   }}
 *   apiBaseUrl="/api/nomad"
 *   agencyId="nwt"
 * />
 * ```
 */
export function TokenRefreshDashboard({
  getAuthToken,
  onTokenRefresh,
  ...props
}: TokenRefreshDashboardProps) {
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // Get initial token
  React.useEffect(() => {
    const loadToken = async () => {
      const currentToken = await getAuthToken();
      setToken(currentToken);
      setLoading(false);
    };
    loadToken();
  }, [getAuthToken]);

  // Set up token refresh (example: refresh every 10 minutes)
  React.useEffect(() => {
    if (!onTokenRefresh) return;

    const refreshInterval = setInterval(async () => {
      try {
        const newToken = await onTokenRefresh();
        setToken(newToken);
      } catch (error) {
        console.error('Token refresh failed:', error);
      }
    }, 10 * 60 * 1000); // 10 minutes

    return () => clearInterval(refreshInterval);
  }, [onTokenRefresh]);

  if (loading) {
    return <div>Loading...</div>;
  }

  return <EmbeddedNomadDashboard {...props} authToken={token} />;
}

// =============================================================================
// Example 4: Full Page Integration Pattern
// =============================================================================

/**
 * Example of a full page layout with sidebar dashboard.
 *
 * This demonstrates the pattern where the dashboard is one
 * section of a larger fire management interface.
 */
export function FullPageIntegrationExample() {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  // Callbacks wired to your app's navigation/state
  const handleLaunchWizard = useCallback((draftId?: string) => {
    console.log('Launch wizard for draft:', draftId);
    // Your navigation: router.push('/modeling/new')
  }, []);

  const handleViewResults = useCallback((modelId: string) => {
    console.log('View results for model:', modelId);
    setSelectedModelId(modelId);
    // Your state management: openResultsPanel(modelId)
  }, []);

  const handleAddToMap = useCallback((modelId: string) => {
    console.log('Add model to map:', modelId);
    // Your map integration: mapStore.addLayer(modelId)
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* Sidebar with Dashboard */}
      <aside style={{ width: '400px', borderRight: '1px solid #e0e0e0' }}>
        <EmbeddedNomadDashboard
          authToken="your-token-here"
          apiBaseUrl="/api/nomad"
          agencyId="example"
          onLaunchWizard={handleLaunchWizard}
          onViewResults={handleViewResults}
          onAddToMap={handleAddToMap}
        />
      </aside>

      {/* Main content area */}
      <main style={{ flex: 1, padding: '20px' }}>
        {selectedModelId ? (
          <div>
            <h2>Model Results: {selectedModelId}</h2>
            {/* Your model results view */}
          </div>
        ) : (
          <div>
            <h2>Select a model to view results</h2>
          </div>
        )}
      </main>
    </div>
  );
}
