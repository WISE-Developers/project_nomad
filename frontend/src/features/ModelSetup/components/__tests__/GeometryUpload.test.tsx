/**
 * Tests for GeometryUpload component (refs #267).
 *
 * Component now POSTs the uploaded file to /api/v1/perimeters/import
 * for server-side validation instead of parsing in-browser.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GeometryUpload } from '../GeometryUpload';

const SAMPLE_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'srv-0',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-115.7, 60.8],
            [-115.7, 60.81],
            [-115.69, 60.81],
            [-115.69, 60.8],
            [-115.7, 60.8],
          ],
        ],
      },
    },
  ],
};

describe('GeometryUpload — server-side validation', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('POSTs the uploaded file to /api/v1/perimeters/import and forwards features to onUpload', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_FC), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onUpload = vi.fn();
    render(<GeometryUpload onUpload={onUpload} />);

    const file = new File([JSON.stringify(SAMPLE_FC)], 'ignition.geojson', {
      type: 'application/geo+json',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/perimeters/import');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    const features = onUpload.mock.calls[0][0];
    expect(features).toHaveLength(1);
    expect(features[0].properties.inputMethod).toBe('upload');
    expect(features[0].properties.fileName).toBe('ignition.geojson');
  });

  it('shows the server-provided error message when the endpoint returns 400', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed for content: must be valid JSON',
            details: { fieldErrors: [{ field: 'content', message: 'must be valid JSON' }] },
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const onUpload = vi.fn();
    render(<GeometryUpload onUpload={onUpload} />);

    const file = new File(['not json'], 'broken.geojson', { type: 'application/geo+json' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);

    await waitFor(() =>
      expect(screen.getByText(/must be valid JSON/i)).toBeInTheDocument(),
    );
    expect(onUpload).not.toHaveBeenCalled();
  });
});
