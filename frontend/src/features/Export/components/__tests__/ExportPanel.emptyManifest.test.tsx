/**
 * #490 — ExportPanel must explain an empty manifest instead of rendering a
 * broken sentence.
 *
 * Found in a real browser on a test VPS, not here: a COMPLETED model whose sim
 * outputs are absent returns 200 from /models/:id/export-manifest with empty
 * categories and NO `totalFiles` — a field `ExportManifest` declares required.
 * The panel rendered "0 of  files selected", with a gap where the number should
 * be, no categories, and a disabled "Export 0 Files".
 *
 * That state is newly reachable because export moved onto the dashboard. The
 * review-panel path cannot produce it: `OutputList` early-returns its "No
 * outputs available" empty state and never renders an Export control at all. So
 * this is condition 3's failure shape reappearing on the new surface, and it is
 * fixed in the component rather than at the call site — gating the card would
 * need the manifest prefetch the design avoids, and would leave the next
 * surface to rediscover the same bug.
 *
 * @module features/Export/components/__tests__
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ExportPanel } from '../ExportPanel.js';
import { OpenNomadProvider } from '../../../../openNomad/context/OpenNomadProvider.js';
import { createMockOpenNomadAPI } from '../../../../test/mocks/openNomad.js';

// ExportPanel keeps useExportGeneration for the share-link flow, which needs the
// provider. Without it the panel throws and every assertion below would fail for
// a reason that has nothing to do with the manifest.
function renderPanel() {
  return render(
    <OpenNomadProvider adapter={createMockOpenNomadAPI()}>
      <ExportPanel modelId="m1" modelName="Hay River" outputs={[]} onClose={vi.fn()} />
    </OpenNomadProvider>
  );
}

// Shaped from the ACTUAL response observed on the server, including the absent
// modelId/totalFiles. A fixture that supplied them would be testing a response
// the backend does not send.
const EMPTY_MANIFEST = { categories: { inputs: [], aggregated: [], final: [] } };

const POPULATED_MANIFEST = {
  modelId: 'm1',
  totalFiles: 1,
  categories: {
    inputs: [
      { filename: 'weather.csv', category: 'inputs', label: 'Weather Data', format: 'csv', path: 'p' },
    ],
    aggregated: [],
    final: [],
  },
};

function stubManifest(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }))
  );
}

describe('#490 — ExportPanel with an empty manifest', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('explains that there is nothing to export instead of printing a gap', async () => {
    stubManifest(EMPTY_MANIFEST);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/no files available to export/i)).toBeTruthy();
    });

    // The defect verbatim: "0 of  files selected", with nothing between "of" and
    // "files" because totalFiles is undefined.
    expect(screen.queryByText(/of\s+files selected/i)).toBeNull();
  });

  it('does not offer a delivery choice or an export action when there is nothing to send', async () => {
    stubManifest(EMPTY_MANIFEST);

    renderPanel();

    await waitFor(() => expect(screen.getByText(/no files available to export/i)).toBeTruthy());

    expect(screen.queryByRole('button', { name: /export 0 files/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^zip$/i })).toBeNull();
  });

  it('CONTROL — a populated manifest still renders the file list and the count', async () => {
    // Without this, every expectation above would pass against a panel that had
    // stopped rendering anything at all.
    stubManifest(POPULATED_MANIFEST);

    renderPanel();

    await waitFor(() => expect(screen.getByText('Weather Data')).toBeTruthy());

    expect(screen.getByText(/1 of 1 files selected/i)).toBeTruthy();
    expect(screen.queryByText(/no files available to export/i)).toBeNull();
    expect(screen.getByRole('button', { name: /export 1 file/i })).toBeTruthy();
  });
});
