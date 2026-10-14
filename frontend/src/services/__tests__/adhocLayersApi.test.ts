/**
 * #315b — the client half of ad-hoc layers.
 *
 * These are thin wrappers, and thin wrappers are exactly where this codebase
 * has been bitten before. Two faults these tests exist to catch:
 *
 * **The double prefix.** `request<T>()` already prepends `/api/v1`, so a caller
 * passing a full path produces `/api/v1/api/v1/...` — a 404 that looks like a
 * missing route. There are TWO API surfaces in this app and they disagree:
 * `openNomad`'s `api.fetch()` IS a raw passthrough wanting full paths, while
 * this module's functions take bare endpoints. Confusing them is a standing
 * trap, recorded in the reading list.
 *
 * **Flattening the refusals.** The backend deliberately answers a bad
 * catalogue two different ways — 502 "could not read it" versus 400 "read it,
 * publishes no layers" — and names the cause in its own words. A client that
 * throws a generic Error, or keeps the message but drops the status, undoes
 * that work from the other end. The UI must be able to tell the two apart AND
 * show the server's text.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  listAdhocLayers,
  createAdhocLayer,
  deleteAdhocLayer,
  fetchWmsCapabilities,
  ApiError,
} from '../api.js';

const SERVICE_URL = 'https://openmaps.gov.bc.ca/geo/pub/wms';

const SHARED_LAYER = {
  id: 'layer-1',
  name: 'BC Hydrography',
  serviceUrl: SERVICE_URL,
  layerName: 'pub:WHSE_WATER.FWA_RIVERS_POLY',
  wmsVersion: '1.3.0',
  legendUrl: null,
  createdBy: 'dylan',
  createdAt: '2026-10-13T12:00:00.000Z',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Captures every request so the exact URL can be asserted, not assumed. */
function stubFetch(responder: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(responder(String(input), init)),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('ad-hoc layers API client', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  describe('the paths — prefixed exactly once', () => {
    it('lists from /api/v1/adhoc-layers', async () => {
      const spy = stubFetch(() => jsonResponse({ layers: [SHARED_LAYER] }));

      const result = await listAdhocLayers();

      expect(spy).toHaveBeenCalledTimes(1);
      const url = String(spy.mock.calls[0][0]);
      expect(url).toBe('/api/v1/adhoc-layers');
      // The fault this guards: /api/v1/api/v1/adhoc-layers reads as a missing route.
      expect(url).not.toContain('/api/v1/api/v1');
      expect(result.layers).toHaveLength(1);
      expect(result.layers[0].createdBy).toBe('dylan');
    });

    it('creates with POST and a JSON body', async () => {
      const spy = stubFetch(() => jsonResponse({ layer: SHARED_LAYER }, 201));

      const created = await createAdhocLayer({
        name: 'BC Hydrography',
        serviceUrl: SERVICE_URL,
        layerName: 'pub:WHSE_WATER.FWA_RIVERS_POLY',
        wmsVersion: '1.3.0',
      });

      const [url, init] = spy.mock.calls[0];
      expect(String(url)).toBe('/api/v1/adhoc-layers');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        name: 'BC Hydrography',
        layerName: 'pub:WHSE_WATER.FWA_RIVERS_POLY',
      });
      expect(created.layer.id).toBe('layer-1');
    });

    it('deletes by id with DELETE', async () => {
      const spy = stubFetch(() => new Response(null, { status: 204 }));

      await deleteAdhocLayer('layer-1');

      const [url, init] = spy.mock.calls[0];
      expect(String(url)).toBe('/api/v1/adhoc-layers/layer-1');
      expect(init?.method).toBe('DELETE');
    });
  });

  describe('reading a catalogue', () => {
    it('sends the service url as an ENCODED query parameter', async () => {
      // A WMS url carries its own query string. Concatenated raw, its `?` and
      // `&` merge into ours and the server sees different parameters than we
      // sent — the kind of fault that works against one server and fails
      // against the next.
      const messy = 'https://example.org/geoserver/wms?map=/data/a&b=1';
      const spy = stubFetch(() => jsonResponse({ version: '1.3.0', layers: [] }));

      await fetchWmsCapabilities(messy);

      const url = String(spy.mock.calls[0][0]);
      expect(url).toContain('/api/v1/adhoc-layers/capabilities?');
      expect(url).toContain(`url=${encodeURIComponent(messy)}`);
      // The service url's own separators must not become ours.
      expect(url).not.toContain('wms?map=/data/a&b=1');
    });

    it('passes a version only when one is given', async () => {
      const spy = stubFetch(() => jsonResponse({ version: '1.1.1', layers: [] }));

      await fetchWmsCapabilities(SERVICE_URL);
      expect(String(spy.mock.calls[0][0])).not.toContain('version=');

      await fetchWmsCapabilities(SERVICE_URL, '1.1.1');
      expect(String(spy.mock.calls[1][0])).toContain('version=1.1.1');
    });

    it('returns the published layers for the chooser', async () => {
      stubFetch(() =>
        jsonResponse({
          version: '1.3.0',
          layers: [{ name: 'pub:RIVERS', title: 'FWA Rivers', abstract: 'rivers' }],
        }),
      );

      const result = await fetchWmsCapabilities(SERVICE_URL);

      expect(result.version).toBe('1.3.0');
      expect(result.layers[0]).toMatchObject({ name: 'pub:RIVERS', title: 'FWA Rivers' });
    });
  });

  describe('the two refusals stay distinguishable', () => {
    it('keeps the status AND the server’s own words for 502 "could not read it"', async () => {
      stubFetch(() =>
        jsonResponse(
          {
            error: {
              message:
                'Could not read the WMS catalogue at example.org: ECONNREFUSED. ' +
                'No layer has been added.',
              code: 'CAPABILITIES_UNREACHABLE',
            },
          },
          502,
        ),
      );

      await expect(fetchWmsCapabilities(SERVICE_URL)).rejects.toBeInstanceOf(ApiError);

      const error = await fetchWmsCapabilities(SERVICE_URL).catch((e: unknown) => e as ApiError);
      expect(error.status).toBe(502);
      expect(error.message).toContain('ECONNREFUSED');
      expect(error.message).toContain('Could not read');
    });

    it('keeps the status and words for 400 "read it, publishes no layers"', async () => {
      stubFetch(() =>
        jsonResponse(
          {
            error: {
              message:
                'The catalogue at example.org was read successfully and publishes no layers, ' +
                'so there is nothing to choose.',
            },
          },
          400,
        ),
      );

      const error = await fetchWmsCapabilities(SERVICE_URL).catch((e: unknown) => e as ApiError);
      expect(error.status).toBe(400);
      expect(error.message).toContain('publishes no layers');
    });

    it('THE PAIR: the two refusals do not arrive at the UI looking alike', async () => {
      // Each case above passes on its own even if the client collapsed both
      // into one generic error. This is the assertion that cannot.
      stubFetch(() =>
        jsonResponse({ error: { message: 'Could not read the WMS catalogue' } }, 502),
      );
      const unreachable = await fetchWmsCapabilities(SERVICE_URL).catch(
        (e: unknown) => e as ApiError,
      );

      vi.unstubAllGlobals();
      stubFetch(() => jsonResponse({ error: { message: 'publishes no layers' } }, 400));
      const empty = await fetchWmsCapabilities(SERVICE_URL).catch((e: unknown) => e as ApiError);

      expect(unreachable.status).not.toBe(empty.status);
      expect(unreachable.message).not.toBe(empty.message);
    });

    it('surfaces a creator-only delete refusal with the owner’s name intact', async () => {
      stubFetch(() =>
        jsonResponse(
          {
            error: {
              message:
                'This layer was added by dylan and only they can remove it. ' +
                'You can hide it from your own map instead.',
              code: 'NOT_LAYER_OWNER',
            },
          },
          403,
        ),
      );

      const error = await deleteAdhocLayer('layer-1').catch((e: unknown) => e as ApiError);

      expect(error.status).toBe(403);
      // Naming the owner is the whole point of the 403 over a 404.
      expect(error.message).toContain('dylan');
    });
  });
});
