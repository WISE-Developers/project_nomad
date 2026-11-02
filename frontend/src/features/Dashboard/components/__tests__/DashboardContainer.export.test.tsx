/**
 * #490 condition 5 — the new entry point must reach the export flow, and a test
 * must cover it so the affordance cannot disappear silently.
 *
 * This is the path test: it drives the real route (model list -> card -> export
 * overlay) rather than asserting that a callback was handed to a child. The card
 * gate itself is pinned separately in ModelCard.export.test.tsx.
 *
 * `mockModels` carries its own controls: model-1 is `completed` and model-2 is
 * `running`, so a single render shows both that the affordance appears where
 * results exist and that it is withheld where they do not. A change that
 * rendered Export for every model would fail here even though the "appears" half
 * still passed.
 *
 * @module features/Dashboard/components/__tests__
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardContainer } from '../DashboardContainer.js';
import { OpenNomadProvider } from '../../../../openNomad/context/OpenNomadProvider.js';
import { createMockOpenNomadAPI } from '../../../../test/mocks/openNomad.js';
import type { IOpenNomadAPI } from '../../../../openNomad/api.js';

function createWrapper(mockApi: IOpenNomadAPI) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <OpenNomadProvider adapter={mockApi}>{children}</OpenNomadProvider>;
  };
}

// ExportPanel fetches its own manifest on mount. Stubbing it is what makes this a
// test of the ROUTE rather than of the backend.
const manifest = {
  modelId: 'model-1',
  categories: {
    inputs: [
      { filename: 'ignition.geojson', category: 'inputs', label: 'Ignition', format: 'geojson', path: 'p' },
    ],
    aggregated: [],
    final: [],
  },
  totalFiles: 1,
};

describe('#490 C5 — the dashboard list reaches the export flow', () => {
  let mockApi: IOpenNomadAPI;

  beforeEach(() => {
    mockApi = createMockOpenNomadAPI();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the ExportPanel for the clicked model, and offers Export only where results exist', async () => {
    const Wrapper = createWrapper(mockApi);

    render(
      <Wrapper>
        <DashboardContainer mode="embedded" />
      </Wrapper>
    );

    // Both fixture models must be on screen before counting controls, or an
    // absence below would just mean "not rendered yet".
    await waitFor(() => {
      expect(screen.getByText('Test Fire Model 1')).toBeTruthy();
      expect(screen.getByText('Test Fire Model 2')).toBeTruthy();
    });

    // One completed model, one running: exactly one Export control.
    const exportButtons = screen.getAllByRole('button', { name: /export model/i });
    expect(exportButtons).toHaveLength(1);

    await userEvent.click(exportButtons[0]);

    // The panel is reached...
    await waitFor(() => {
      expect(screen.getByText('Export Model Data')).toBeTruthy();
    });

    // ...and it is the real ExportPanel driven by the fetched manifest, not an
    // empty shell: this label exists only in the stubbed manifest response.
    await waitFor(() => {
      expect(screen.getByText('Ignition')).toBeTruthy();
    });

    const calledUrls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => String(c[0])
    );
    expect(calledUrls.some((u) => u.includes('/api/v1/models/model-1/export-manifest'))).toBe(true);
  });

  it('withholds the list Export affordance when the host disables the export feature', async () => {
    const Wrapper = createWrapper(mockApi);

    render(
      <Wrapper>
        <DashboardContainer mode="embedded" features={{ export: false }} />
      </Wrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Fire Model 1')).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: /export model/i })).toBeNull();
  });
});
