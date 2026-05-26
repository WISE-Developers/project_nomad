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

describe('GeometryUpload — Shapefile support (#268)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('mentions shapefile support in the dropzone help text', () => {
    render(<GeometryUpload onUpload={vi.fn()} />);
    expect(screen.getByText(/shapefile/i)).toBeInTheDocument();
  });

  it("includes .zip and shapefile sidecar extensions in the file input's accept attribute", () => {
    render(<GeometryUpload onUpload={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toMatch(/\.zip/);
    expect(input.accept).toMatch(/\.shp/);
  });

  it('POSTs a zipped shapefile to /api/v1/perimeters/import as the file field', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_FC), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onUpload = vi.fn();
    render(<GeometryUpload onUpload={onUpload} />);

    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'perimeter.zip', {
      type: 'application/zip',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/v1/perimeters/import');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const sentFile = (init.body as FormData).get('file') as File;
    expect(sentFile.name).toBe('perimeter.zip');

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
  });

  it('zips raw multi-file shapefile selection (.shp + sidecars) before upload', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_FC), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onUpload = vi.fn();
    render(<GeometryUpload onUpload={onUpload} />);

    const shp = new File([new Uint8Array([0, 0, 0, 0])], 'fixture.shp', { type: '' });
    const shx = new File([new Uint8Array([0, 0, 0, 0])], 'fixture.shx', { type: '' });
    const dbf = new File([new Uint8Array([0, 0, 0, 0])], 'fixture.dbf', { type: '' });
    const prj = new File(['GEOGCS["WGS 84",DATUM["WGS_1984"]]'], 'fixture.prj', {
      type: '',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, [shp, shx, dbf, prj]);

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const [, init] = mockFetch.mock.calls[0];
    const sentFile = (init.body as FormData).get('file') as File;
    expect(sentFile.name).toMatch(/\.zip$/);
    // Read blob via FileReader for compatibility with jsdom (no Blob.arrayBuffer)
    const buf = await new Promise<Uint8Array>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(sentFile);
    });
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
  });

  it('rejects raw multi-file shapefile selection missing the .shp file', async () => {
    const onUpload = vi.fn();
    render(<GeometryUpload onUpload={onUpload} />);

    const shx = new File([new Uint8Array([0])], 'fixture.shx', { type: '' });
    const dbf = new File([new Uint8Array([0])], 'fixture.dbf', { type: '' });
    const prj = new File(['prj'], 'fixture.prj', { type: '' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, [shx, dbf, prj]);

    await waitFor(() =>
      expect(screen.getByText(/must include a \.shp/i)).toBeInTheDocument(),
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('renders server-provided shapefile fieldErrors inline (e.g., missing .prj sidecar)', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Shapefile is missing required .prj sidecar',
            details: {
              fieldErrors: [{ field: 'prj', message: 'Shapefile is missing required .prj sidecar' }],
            },
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const onUpload = vi.fn();
    render(<GeometryUpload onUpload={onUpload} />);

    const file = new File([new Uint8Array([0x50, 0x4b])], 'broken.zip', {
      type: 'application/zip',
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);

    await waitFor(() =>
      expect(screen.getByText(/\.prj sidecar/i)).toBeInTheDocument(),
    );
    expect(onUpload).not.toHaveBeenCalled();
  });
});
