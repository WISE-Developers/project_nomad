/**
 * #315 — the SSRF guard on the GetCapabilities proxy.
 *
 * Franco ruled 2026-10-12: "backend is better to avoid cors". He is right about
 * the user experience — NRCan serves map tiles to a browser but refuses to serve
 * its capabilities XML, so a browser-side layer chooser works for some servers
 * and not others, and "this server has no layers" is indistinguishable from "I
 * could not read the catalogue".
 *
 * The cost of that decision is this file. **The backend now fetches a URL a user
 * typed**, which turns Nomad's server into a request-forwarding device. Without
 * a guard, anyone who can reach the add-layer form can use our server to probe
 * things our server can reach and they cannot: other containers, the host, the
 * cloud metadata endpoint.
 *
 * This is not hypothetical paranoia — `169.254.169.254` returns instance
 * credentials on most cloud providers, and a proxy that will fetch an arbitrary
 * URL and hand back the body is the whole exploit.
 *
 * DENY BY DEFAULT. Every assertion below is about what is REFUSED. The one
 * allow-test exists so a guard that refuses everything cannot pass — a check
 * that never permits anything is as useless as one that never refuses.
 */
import { describe, it, expect } from 'vitest';
import { validateWmsUrl } from '../validateWmsUrl.js';

/** Convenience: did the guard allow it? */
function allowed(url: string): boolean {
  return validateWmsUrl(url).ok;
}

function reason(url: string): string {
  const result = validateWmsUrl(url);
  return result.ok ? '' : result.reason;
}

describe('validateWmsUrl — SSRF guard', () => {
  describe('the control: it permits a legitimate public service', () => {
    it('allows a real public WMS endpoint', () => {
      // Without this, every assertion below is satisfied by `return false`.
      expect(allowed('https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wms')).toBe(true);
      expect(allowed('https://openmaps.gov.bc.ca/geo/pub/wms')).toBe(true);
    });

    it('allows a service url that carries its own query parameters', () => {
      expect(allowed('https://example.org/cgi-bin/mapserv?map=/data/fire.map')).toBe(true);
    });
  });

  describe('scheme', () => {
    it('refuses anything that is not http or https', () => {
      // file:// would read the server's own disk and hand it back.
      expect(allowed('file:///etc/passwd')).toBe(false);
      expect(allowed('gopher://example.org/')).toBe(false);
      expect(allowed('ftp://example.org/')).toBe(false);
      expect(reason('file:///etc/passwd')).toMatch(/scheme|http/i);
    });

    it('refuses a url with no scheme at all', () => {
      expect(allowed('example.org/wms')).toBe(false);
    });
  });

  describe('loopback', () => {
    it('refuses localhost by name and by address', () => {
      expect(allowed('http://localhost/wms')).toBe(false);
      expect(allowed('http://127.0.0.1/wms')).toBe(false);
      expect(allowed('http://127.1.2.3/wms')).toBe(false);
      expect(allowed('http://[::1]/wms')).toBe(false);
    });

    it('refuses loopback on a non-default port', () => {
      // The backend itself listens on 3001; the database and other services sit
      // on other ports. A port is not a protection.
      expect(allowed('http://127.0.0.1:3001/api/v1/usage')).toBe(false);
      expect(allowed('http://localhost:5432/')).toBe(false);
    });
  });

  describe('private ranges', () => {
    it('refuses RFC1918 addresses', () => {
      expect(allowed('http://10.0.0.5/wms')).toBe(false);
      expect(allowed('http://172.16.0.1/wms')).toBe(false);
      expect(allowed('http://172.31.255.254/wms')).toBe(false);
      expect(allowed('http://192.168.1.1/wms')).toBe(false);
    });

    it('does NOT refuse 172.32.x, which is public', () => {
      // The 172.16/12 block ends at 172.31. A guard that refuses all of 172.x
      // is over-broad and would block legitimate public servers — the other
      // direction of wrong, and the reason this test exists.
      expect(allowed('http://172.32.0.1/wms')).toBe(true);
      expect(allowed('http://172.15.0.1/wms')).toBe(true);
    });
  });

  describe('link-local — the cloud metadata endpoint', () => {
    it('refuses 169.254.0.0/16', () => {
      // 169.254.169.254 serves instance credentials on AWS, GCP and Azure.
      expect(allowed('http://169.254.169.254/latest/meta-data/')).toBe(false);
      expect(allowed('http://169.254.1.1/')).toBe(false);
    });

    it('names metadata or link-local in the refusal, so the log is readable', () => {
      expect(reason('http://169.254.169.254/')).toMatch(/link-local|metadata|private/i);
    });
  });

  describe('other reserved space', () => {
    it('refuses 0.0.0.0 and the broadcast address', () => {
      expect(allowed('http://0.0.0.0/wms')).toBe(false);
      expect(allowed('http://255.255.255.255/wms')).toBe(false);
    });

    it('refuses IPv6 unique-local and link-local', () => {
      expect(allowed('http://[fc00::1]/wms')).toBe(false);
      expect(allowed('http://[fe80::1]/wms')).toBe(false);
    });
  });

  describe('obfuscation', () => {
    it('refuses decimal and octal spellings of loopback', () => {
      // 2130706433 === 127.0.0.1. A guard matching the string "127." misses it.
      expect(allowed('http://2130706433/wms')).toBe(false);
      expect(allowed('http://0177.0.0.1/wms')).toBe(false);
    });

    it('refuses credentials embedded in the authority', () => {
      // `http://evil.org@127.0.0.1/` is parsed by some clients as host
      // 127.0.0.1 and by careless guards as host evil.org.
      expect(allowed('http://example.org@127.0.0.1/wms')).toBe(false);
    });
  });

  describe('what this guard does NOT cover — declared, not hidden', () => {
    it('cannot stop DNS rebinding, and says so rather than implying safety', () => {
      // A public name that resolves to 127.0.0.1 passes every check here,
      // because the hostname is public and we have not resolved it. Closing it
      // needs resolution at fetch time plus a re-check against the resolved
      // address, and even then TOCTOU remains.
      //
      // This test documents the hole. It asserts the CURRENT behaviour so that
      // if someone later closes it, this test fails and they must come here and
      // update the declaration rather than leaving a stale claim in the file.
      expect(allowed('http://a-public-name-that-resolves-to-localhost.example/wms')).toBe(true);
    });
  });
});
