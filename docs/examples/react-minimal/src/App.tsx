/**
 * Main Application Component
 *
 * Shows the Nomad Dashboard embedded in a sidebar layout.
 */

import React, { useMemo, useState } from 'react';
import {
  OpenNomadProvider,
  DashboardContainer,
  createAgencyAdapter,
} from '@nomad/frontend';

export function App() {
  // In a real app, get this from your auth system
  const authToken = 'example-auth-token';

  // Track selected model for the main content area
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  // Create the adapter - memoized to prevent recreation on re-renders
  const adapter = useMemo(
    () =>
      createAgencyAdapter({
        authToken,
        apiBaseUrl: '/api/nomad',
        agencyId: 'example-agency',
      }),
    [authToken]
  );

  // Callbacks for dashboard actions
  const handleLaunchWizard = (draftId?: string) => {
    console.log('Launch wizard for draft:', draftId);
    // Navigate to your wizard route
    // router.push(`/modeling/new${draftId ? `?draft=${draftId}` : ''}`);
  };

  const handleViewResults = (modelId: string) => {
    console.log('View results for model:', modelId);
    setSelectedModelId(modelId);
  };

  const handleAddToMap = (modelId: string) => {
    console.log('Add model to map:', modelId);
    // Add model results to your map component
  };

  return (
    <>
      <header>
        <h1>Agency Fire Management System</h1>
      </header>
      <main>
        {/* Sidebar with embedded Nomad Dashboard */}
        <aside className="sidebar">
          <OpenNomadProvider adapter={adapter}>
            <DashboardContainer
              mode="embedded"
              onLaunchWizard={handleLaunchWizard}
              onViewResults={handleViewResults}
              onAddToMap={handleAddToMap}
              initialTab="models"
            />
          </OpenNomadProvider>
        </aside>

        {/* Main content area */}
        <section className="content">
          {selectedModelId ? (
            <div>
              <h2>Model Results</h2>
              <p>Viewing model: {selectedModelId}</p>
              {/* Your map or results visualization here */}
            </div>
          ) : (
            <div>
              <h2>Welcome</h2>
              <p>Select a model from the sidebar to view results.</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
