/**
 * Tests for ModelReviewPanel mode awareness
 *
 * Verifies that ModelReviewPanel renders correctly in both
 * floating (Rnd) and embedded (plain div) modes.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { OpenNomadProvider } from '../../../../openNomad/context';
import { createMockOpenNomadAPI } from '../../../../test/mocks/openNomad';
import { ModelReviewPanel } from '../ModelReviewPanel';
import type { IOpenNomadAPI } from '../../../../openNomad/api';
import type { ModelResultsResponse } from '../../types';

// =============================================================================
// Mocks
// =============================================================================

// Mock react-rnd to detect when Rnd is rendered
vi.mock('react-rnd', () => ({
  Rnd: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('div', { 'data-testid': 'rnd-wrapper', ...props }, children),
}));

const mockResultsResponse: ModelResultsResponse = {
  modelId: 'model-1',
  modelName: 'Test Model',
  engineType: 'firestarr',
  userId: 'user-1',
  executionSummary: {
    startedAt: '2024-01-01T10:00:00Z',
    completedAt: '2024-01-01T11:00:00Z',
    durationSeconds: 3600,
    status: 'completed',
    progress: 100,
  },
  outputs: [],
};

// =============================================================================
// Helpers
// =============================================================================

function createMockApi(): IOpenNomadAPI & { fetch: ReturnType<typeof vi.fn> } {
  const baseApi = createMockOpenNomadAPI();
  return {
    ...baseApi,
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResultsResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ),
    getBaseUrl: vi.fn().mockReturnValue(''),
    results: {
      ...baseApi.results,
      get: vi.fn().mockResolvedValue(mockResultsResponse),
      getModelResultsUrl: vi.fn().mockImplementation(
        (modelId: string) => `/api/v1/models/${modelId}/results`
      ),
      getPreviewUrl: vi.fn().mockReturnValue('/preview'),
      getDownloadUrl: vi.fn().mockReturnValue('/download'),
      getTileUrlTemplate: vi.fn().mockReturnValue('/tiles/{z}/{x}/{y}'),
      getTileBounds: vi.fn().mockResolvedValue([-115, 62, -114, 63]),
    },
  };
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof ModelReviewPanel>> = {},
  api?: IOpenNomadAPI
) {
  const mockApi = api || createMockApi();
  return render(
    React.createElement(
      OpenNomadProvider,
      { adapter: mockApi },
      React.createElement(ModelReviewPanel, {
        modelId: 'model-1',
        onClose: vi.fn(),
        ...props,
      })
    )
  );
}

// =============================================================================
// Tests
// =============================================================================

describe('ModelReviewPanel - mode awareness', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders Rnd wrapper in floating mode (default)', () => {
    renderPanel();
    expect(screen.getByTestId('rnd-wrapper')).toBeTruthy();
  });

  it('renders Rnd wrapper when mode is explicitly "floating"', () => {
    renderPanel({ mode: 'floating' });
    expect(screen.getByTestId('rnd-wrapper')).toBeTruthy();
  });

  it('does NOT render Rnd wrapper in embedded mode', () => {
    renderPanel({ mode: 'embedded' });
    expect(screen.queryByTestId('rnd-wrapper')).toBeNull();
  });

  it('renders embedded container div in embedded mode', () => {
    renderPanel({ mode: 'embedded' });
    expect(screen.getByTestId('model-review-embedded')).toBeTruthy();
  });

  it('renders close button in both modes', () => {
    const { unmount } = renderPanel({ mode: 'floating' });
    expect(screen.getByLabelText('Close results panel')).toBeTruthy();
    unmount();

    renderPanel({ mode: 'embedded' });
    expect(screen.getByLabelText('Close results panel')).toBeTruthy();
  });

  it('calls onClose when close button clicked in embedded mode', async () => {
    const onClose = vi.fn();
    renderPanel({ mode: 'embedded', onClose });

    const closeBtn = screen.getByLabelText('Close results panel');
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not show drag hint in embedded mode', () => {
    renderPanel({ mode: 'embedded' });
    expect(screen.queryByText('drag to move')).toBeNull();
  });

  it('renders "Model Results" heading in both modes', () => {
    const { unmount } = renderPanel({ mode: 'floating' });
    expect(screen.getByText('Model Results')).toBeTruthy();
    unmount();

    renderPanel({ mode: 'embedded' });
    expect(screen.getByText('Model Results')).toBeTruthy();
  });
});
