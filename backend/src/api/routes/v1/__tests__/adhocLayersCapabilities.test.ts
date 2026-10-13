/**
 * #315 — reading a WMS catalogue so the user can CHOOSE a layer.
 *
 * Papa's ruling: **the user must choose a layer, not type its name.** That is
 * the whole reason this route exists. A free-text layer name fails at the worst
 * possible moment — a silent empty tile during an incident — whereas a chooser
 * cannot offer a name the server does not publish.
 *
 * His second ruling: **an unreadable catalogue REFUSES the url.** We do not
 * store a layer we could not verify.
 *
 * THE DISTINCTION THIS FILE EXISTS TO PROTECT:
 *
 *   "I read the catalogue and it publishes no layers"   — the server is bare
 *   "I could not read the catalogue"                    — I do not know
 *
 * `parseCapabilities` already keeps those apart. A route can throw that away in
 * one line by mapping both onto "no layers available", so the pair is asserted
 * here with an explicit inequality rather than left to inspection. An absence
 * reported in the same words as a nothing is the house's most common failure.
 *
 * The SSRF case asserts ORDER, not just refusal: the guard must run BEFORE the
 * fetch. A guard that refuses after the request has already left has not
 * protected anything.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { default: adhocLayersRouter } = await import('../adhocLayers.js');
const { errorHandler } = await import('../../../middleware/errorHandler.js');

function buildApp(asUser = 'dylan') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { user?: string }).user = asUser;
    next();
  });
  app.use('/api/v1', adhocLayersRouter);
  app.use(errorHandler);
  return app;
}

const SERVICE_URL = 'https://openmaps.gov.bc.ca/geo/pub/wms';

const CAPABILITIES_130 = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service><Name>WMS</Name><Title>BC Open Maps</Title></Service>
  <Capability>
    <Layer>
      <Title>Root</Title>
      <Layer queryable="1">
        <Name>pub:WHSE_WATER.FWA_RIVERS_POLY</Name>
        <Title>FWA Rivers</Title>
        <Abstract>Freshwater atlas river polygons</Abstract>
      </Layer>
      <Layer queryable="1">
        <Name>pub:WHSE_BASEMAPPING.NTS_50K_GRID</Name>
        <Title>NTS 50k Grid</Title>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

/** Well-formed, correct version, and genuinely publishes nothing. */
const CAPABILITIES_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service><Name>WMS</Name><Title>An empty server</Title></Service>
  <Capability><Layer><Title>Root</Title></Layer></Capability>
</WMS_Capabilities>`;

/** What an SSO-fronted server actually returns: 200, and HTML. */
const LOGIN_PAGE = `<!DOCTYPE html><html><head><title>Sign in</title></head>
<body><form action="/login"><input name="password" type="password"/></form></body></html>`;

const SERVICE_EXCEPTION = `<?xml version="1.0" encoding="UTF-8"?>
<ServiceExceptionReport version="1.3.0">
  <ServiceException code="InvalidFormat">Layer catalogue is being rebuilt, retry later</ServiceException>
</ServiceExceptionReport>`;

function stubFetch(impl: (url: string) => Promise<Response> | Response) {
  const spy = vi.fn((input: string | URL) => Promise.resolve(impl(String(input))));
  vi.stubGlobal('fetch', spy);
  return spy;
}

function textResponse(body: string, init: { status?: number; contentType?: string } = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'text/xml' },
  });
}

/** The one assertion every refusal shares: nothing is offered to choose from. */
function offersNoChoice(body: unknown) {
  const asText = JSON.stringify(body);
  expect(asText).not.toMatch(/FWA_RIVERS_POLY/);
}

describe('GET /adhoc-layers/capabilities', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('the control: a readable catalogue', () => {
    it('returns the published layers so the user can choose one', async () => {
      stubFetch(() => textResponse(CAPABILITIES_130));

      const res = await request(buildApp())
        .get('/api/v1/adhoc-layers/capabilities')
        .query({ url: SERVICE_URL })
        .expect(200);

      expect(res.body.version).toBe('1.3.0');
      expect(res.body.layers).toHaveLength(2);
      expect(res.body.layers[0]).toMatchObject({
        name: 'pub:WHSE_WATER.FWA_RIVERS_POLY',
        title: 'FWA Rivers',
      });
    });

    it('asks the server for its capabilities, not for a map', async () => {
      // Without this the route could fetch the bare service url and parse
      // whatever came back — which works against servers that default to
      // GetCapabilities and fails against those that do not.
      const spy = stubFetch(() => textResponse(CAPABILITIES_130));

      await request(buildApp())
        .get('/api/v1/adhoc-layers/capabilities')
        .query({ url: SERVICE_URL })
        .expect(200);

      expect(spy).toHaveBeenCalledTimes(1);
      const requested = String(spy.mock.calls[0][0]).toLowerCase();
      expect(requested).toContain('request=getcapabilities');
      expect(requested).toContain('service=wms');
    });
  });

  describe('the SSRF guard runs BEFORE the fetch', () => {
    it('refuses a link-local address without making a request at all', async () => {
      const spy = stubFetch(() => textResponse(CAPABILITIES_130));

      const res = await request(buildApp())
        .get('/api/v1/adhoc-layers/capabilities')
        .query({ url: 'http://169.254.169.254/latest/meta-data/' });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/link-local|metadata|private/i);
      // The point of the test: no request left this process.
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('"could not read it" is NOT "nothing there"', () => {
    it('refuses, and says it could not READ the catalogue, when the fetch fails', async () => {
      stubFetch(() => {
        throw new Error('ECONNREFUSED');
      });

      const res = await request(buildApp())
        .get('/api/v1/adhoc-layers/capabilities')
        .query({ url: SERVICE_URL });

      expect(res.status).toBe(502);
      expect(JSON.stringify(res.body)).toMatch(/could not|unreachable|failed to reach/i);
      offersNoChoice(res.body);
    });

    it('refuses on an HTTP error status, naming the status', async () => {
      stubFetch(() => textResponse('Gone', { status: 404, contentType: 'text/plain' }));

      const res = await request(buildApp())
        .get('/api/v1/adhoc-layers/capabilities')
        .query({ url: SERVICE_URL });

      expect(res.status).toBe(502);
      expect(JSON.stringify(res.body)).toMatch(/404/);
      offersNoChoice(res.body);
    });

    it('refuses a catalogue that is readable and genuinely empty — with a DIFFERENT reason', async () => {
      stubFetch(() => textResponse(CAPABILITIES_EMPTY));

      const res = await request(buildApp())
        .get('/api/v1/adhoc-layers/capabilities')
        .query({ url: SERVICE_URL });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/no layers|publishes none|empty/i);
      offersNoChoice(res.body);
    });

    it('THE PAIR: the unreachable and the empty catalogue do not read alike', async () => {
      // This is the assertion the other two cannot make on their own. Both
      // refuse; a route that refused both with one message would pass every
      // test above and still tell an operator "this server has nothing" when
      // the truth was "I could not look."
      stubFetch(() => {
        throw new Error('ECONNREFUSED');
      });
      const unreachable = await request(buildApp())
        .get('/api/v1/adhoc-layers/capabilities')
        .query({ url: SERVICE_URL });

      vi.unstubAllGlobals();
      stubFetch(() => textResponse(CAPABILITIES_EMPTY));
      const empty = await request(buildApp())
        .get('/api/v1/adhoc-layers/capabilities')
        .query({ url: SERVICE_URL });

      expect(JSON.stringify(unreachable.body)).not.toBe(JSON.stringify(empty.body));
      expect(unreachable.status).not.toBe(empty.status);
    });
  });

  describe('what servers actually return instead of a catalogue', () => {
    it('refuses an HTML login page BY NAME, not as a parse failure', async () => {
      stubFetch(() => textResponse(LOGIN_PAGE, { contentType: 'text/html' }));

      const res = await request(buildApp())
        .get('/api/v1/adhoc-layers/capabilities')
        .query({ url: SERVICE_URL });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/html|login|sign in|not a wms/i);
    });

    it("surfaces the server's own ServiceException text", async () => {
      // The server explained itself. Replacing its words with ours loses the
      // only part of the message that was specific.
      stubFetch(() => textResponse(SERVICE_EXCEPTION));

      const res = await request(buildApp())
        .get('/api/v1/adhoc-layers/capabilities')
        .query({ url: SERVICE_URL });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/being rebuilt/i);
    });
  });

  describe('the request itself', () => {
    it('requires a url', async () => {
      const res = await request(buildApp()).get('/api/v1/adhoc-layers/capabilities');

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/url/i);
    });
  });
});
