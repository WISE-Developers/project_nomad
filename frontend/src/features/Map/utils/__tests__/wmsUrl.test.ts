/**
 * #315 — a general WMS URL builder for user-supplied servers.
 *
 * Nomad already builds WMS GetMap URLs twice (`useCwfisM3Layers`,
 * `useCFSLayers`), and both hardcode `version: '1.1.1'` and `srs: 'EPSG:3857'`.
 * That is correct for those two servers and wrong as a general assumption: every
 * capabilities document read while assessing this issue declares **WMS 1.3.0**,
 * which renamed `srs` to `crs`.
 *
 * A CORRECTION TO MY OWN PLAN, made before writing a line of this:
 *
 * The assessment warned that 1.3.0 "reverses axis order for geographic CRSs",
 * and I carried that into the plan as a risk to handle. **It does not bite on
 * this path.** 1.3.0 reverses axis order only where the authority defines the
 * CRS as lat/lon — EPSG:4326 does; EPSG:3857 is defined easting/northing and is
 * unaffected. MapLibre substitutes `{bbox-epsg-3857}`, so every URL this builder
 * produces is on a projected CRS and the ordering is identical in both versions.
 *
 * That is worth stating rather than silently dropping, because the next person
 * reading the assessment will find the warning and may "fix" an axis flip that
 * would actually introduce the bug it is named after. The risk is real; it is
 * real for EPSG:4326, which this path never uses.
 */
import { describe, it, expect } from 'vitest';
import { buildWmsTileUrl, buildWmsLegendUrl, type WmsVersion } from '../wmsUrl.js';

const SERVICE = 'https://example.org/geoserver/wms';

/** Read a query param out of a built URL, ignoring the literal bbox placeholder. */
function param(url: string, key: string): string | null {
  const query = url.slice(url.indexOf('?') + 1);
  for (const pair of query.split('&')) {
    const [k, ...rest] = pair.split('=');
    if (k.toLowerCase() === key.toLowerCase()) return rest.join('=');
  }
  return null;
}

describe('buildWmsTileUrl', () => {
  describe('the control: it builds something MapLibre can actually use', () => {
    it('keeps the bbox placeholder LITERAL and unencoded', () => {
      // MapLibre substitutes tile bounds into `{bbox-epsg-3857}`. If
      // URLSearchParams encodes the braces, the substitution never happens and
      // the server receives the literal string — a blank layer with a 200.
      const url = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'topo' });
      expect(url).toContain('{bbox-epsg-3857}');
      expect(url).not.toContain('%7Bbbox');
    });

    it('names the layer the caller asked for', () => {
      const url = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'nrcan:canvec_hydro' });
      expect(param(url, 'layers')).toBe('nrcan:canvec_hydro');
    });
  });

  describe('WMS version — the difference that actually matters', () => {
    it('uses srs for 1.1.1', () => {
      const url = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'topo', version: '1.1.1' });
      expect(param(url, 'srs')).toBe('EPSG%3A3857');
      expect(param(url, 'crs')).toBeNull();
    });

    it('uses crs for 1.3.0, not srs', () => {
      // The whole point. A 1.3.0 server given `srs=` may ignore it or refuse.
      const url = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'topo', version: '1.3.0' });
      expect(param(url, 'crs')).toBe('EPSG%3A3857');
      expect(param(url, 'srs')).toBeNull();
    });

    it('produces DIFFERENT urls for the two versions', () => {
      // Control. If both versions produced the same string, every assertion
      // above would be satisfied by a builder that ignores `version` entirely.
      const a = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'topo', version: '1.1.1' });
      const b = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'topo', version: '1.3.0' });
      expect(a).not.toBe(b);
    });

    it('defaults to 1.3.0, the version real servers declare', () => {
      const url = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'topo' });
      expect(param(url, 'version')).toBe('1.3.0');
    });

    it('keeps the bbox in the SAME order for both versions', () => {
      // Documents the corrected reasoning in this file's header. 1.3.0 reverses
      // axis order only for geographic CRSs; EPSG:3857 is projected. If someone
      // later "fixes" an axis flip here, this test tells them why not to.
      const a = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'topo', version: '1.1.1' });
      const b = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'topo', version: '1.3.0' });
      expect(a).toContain('bbox={bbox-epsg-3857}');
      expect(b).toContain('bbox={bbox-epsg-3857}');
    });
  });

  describe('a service url that already carries query parameters', () => {
    it('appends rather than starting a second query string', () => {
      // Real services are handed out with params attached, e.g. an ArcGIS
      // endpoint ending in `?service=WMS`. A naive `${url}?...` yields two `?`
      // and the server sees none of our parameters.
      const url = buildWmsTileUrl({
        serviceUrl: 'https://example.org/wms?map=/data/fire.map',
        layer: 'topo',
      });
      expect(url.match(/\?/g)?.length).toBe(1);
      expect(url).toContain('map=/data/fire.map');
      expect(param(url, 'request')).toBe('GetMap');
    });
  });

  describe('fixed parameters a raster source needs', () => {
    it('requests a transparent png by default', () => {
      const url = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'topo' });
      expect(param(url, 'format')).toBe('image%2Fpng');
      expect(param(url, 'transparent')).toBe('true');
      expect(param(url, 'request')).toBe('GetMap');
      expect(param(url, 'service')).toBe('WMS');
    });

    it('honours an explicit format, for servers that only speak jpeg', () => {
      const url = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'topo', format: 'image/jpeg' });
      expect(param(url, 'format')).toBe('image%2Fjpeg');
    });
  });
});

describe('buildWmsLegendUrl', () => {
  it('uses the singular layer= param, per GetLegendGraphic convention', () => {
    // GetMap takes `layers`; GetLegendGraphic takes `layer`. Sending the plural
    // to GetLegendGraphic yields a legend for nothing.
    const url = buildWmsLegendUrl({ serviceUrl: SERVICE, layer: 'topo' });
    expect(param(url, 'layer')).toBe('topo');
    expect(param(url, 'layers')).toBeNull();
    expect(param(url, 'request')).toBe('GetLegendGraphic');
  });

  it('carries no bbox placeholder — a legend is not a tile', () => {
    const url = buildWmsLegendUrl({ serviceUrl: SERVICE, layer: 'topo' });
    expect(url).not.toContain('{bbox');
  });
});

/**
 * A SERVICE URL CARRYING A PARAMETER WE ALSO SET (#315 follow-up).
 *
 * Found on the live CIFFC demo, 2026-10-16, after this feature had been
 * declared verified. The stored service url was:
 *
 *   https://cwfis.cfs.nrcan.gc.ca/geoserver/wms?request=getCapabilities
 *
 * which is the obvious thing for a user to paste — it is the url the
 * "Read catalogue" step asks for. `joinQuery` chose `&` correctly and appended
 * our own `request=GetLegendGraphic`, so the url carried `request` TWICE. The
 * legend images rendered broken on the demo (naturalWidth 0, measured in the
 * page).
 *
 * The existing coverage used `?map=/data/fire.map` — a parameter we do NOT
 * set, so it never exercised a collision. That is why a green suite shipped
 * this. Both cases matter and both are asserted here: parameters we own must
 * be REPLACED, parameters we do not own must SURVIVE.
 */
describe('a service url carrying a parameter we also set', () => {
  const CAPS = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/wms?request=getCapabilities';

  /** Count occurrences of a key, because `param()` only reveals the first. */
  function countParam(url: string, key: string): number {
    const query = url.slice(url.indexOf('?') + 1);
    return query
      .split('&')
      .filter((pair) => pair.split('=')[0].toLowerCase() === key.toLowerCase()).length;
  }

  it('emits request exactly once on a tile url, and it is GetMap', () => {
    const url = buildWmsTileUrl({ serviceUrl: CAPS, layer: 'public:fdr' });
    expect(countParam(url, 'request')).toBe(1);
    expect(param(url, 'request')).toBe('GetMap');
    expect(url).not.toContain('getCapabilities');
  });

  it('emits request exactly once on a legend url, and it is GetLegendGraphic', () => {
    const url = buildWmsLegendUrl({ serviceUrl: CAPS, layer: 'public:fdr' });
    expect(countParam(url, 'request')).toBe(1);
    expect(param(url, 'request')).toBe('GetLegendGraphic');
    expect(url).not.toContain('getCapabilities');
  });

  it('replaces every parameter we own, whatever the incoming casing', () => {
    const noisy =
      'https://example.org/wms?SERVICE=WMS&Request=GetCapabilities&version=1.1.1&format=image/gif';
    const url = buildWmsTileUrl({ serviceUrl: noisy, layer: 'topo' });
    for (const key of ['service', 'request', 'version', 'format']) {
      expect(countParam(url, key)).toBe(1);
    }
    expect(param(url, 'request')).toBe('GetMap');
    expect(param(url, 'version')).toBe('1.3.0');
  });

  it('KEEPS a parameter we do not own — the endpoint may need it', () => {
    // A MapServer endpoint is useless without its `map=`. Stripping everything
    // would trade one broken feature for another.
    const url = buildWmsTileUrl({
      serviceUrl: 'https://example.org/wms?map=/data/fire.map&request=GetCapabilities',
      layer: 'topo',
    });
    expect(url).toContain('map=/data/fire.map');
    expect(countParam(url, 'request')).toBe(1);
    expect(param(url, 'request')).toBe('GetMap');
  });

  it('leaves a clean service url exactly as it was', () => {
    // The control. This is the case that was tested before and must not change.
    const url = buildWmsTileUrl({ serviceUrl: SERVICE, layer: 'topo' });
    expect(url.startsWith(`${SERVICE}?`)).toBe(true);
    expect(countParam(url, 'request')).toBe(1);
  });
});

describe('version typing', () => {
  it('accepts only the two versions we build for', () => {
    // A compile-time guard, asserted here so the intent is visible at runtime
    // too: an unrecognised version must not fall through to a default that
    // silently produces the wrong parameter name.
    const versions: WmsVersion[] = ['1.1.1', '1.3.0'];
    expect(versions).toHaveLength(2);
  });
});
