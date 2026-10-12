/**
 * SSRF guard for the WMS GetCapabilities proxy (#315).
 *
 * Franco ruled the capabilities fetch belongs on the backend, to avoid CORS —
 * correct for the user experience, because a browser-side chooser works against
 * some servers and not others, and "no layers" is indistinguishable from "could
 * not read the catalogue".
 *
 * The cost is that **the backend now fetches a URL a user typed.** That makes
 * Nomad a request-forwarding device, able to reach things our server can reach
 * and the user cannot: sibling containers, the host, and the cloud metadata
 * endpoint at 169.254.169.254, which serves instance credentials.
 *
 * So: DENY BY DEFAULT, and refuse with a reason a log reader can act on.
 *
 * WHAT THIS DOES NOT COVER, stated here rather than implied away:
 * **DNS rebinding.** A public hostname that resolves to 127.0.0.1 passes every
 * check below, because the host is public and we have not resolved it. Closing
 * that needs resolution at fetch time plus a re-check of the resolved address,
 * and even then a TOCTOU window remains between check and connect. The guard is
 * a strong filter, not a proof.
 */

export type WmsUrlValidation = { ok: true; url: URL } | { ok: false; reason: string };

/** Only schemes that can carry a WMS response. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parses an IPv4 literal in any of the spellings a URL parser accepts —
 * dotted-decimal, octal (leading zero), hex (0x), and bare decimal.
 *
 * This exists because a guard that string-matches "127." misses `2130706433`
 * and `0177.0.0.1`, both of which resolve to loopback.
 *
 * Returns the address as four octets, or null when the host is not an IPv4
 * literal (a real hostname, or IPv6).
 */
function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');

  const toNumber = (part: string): number | null => {
    if (part === '') return null;
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(part)) value = parseInt(part, 16);
    else if (/^0[0-7]+$/.test(part)) value = parseInt(part, 8);
    else if (/^\d+$/.test(part)) value = parseInt(part, 10);
    else return null;
    return Number.isFinite(value) ? value : null;
  };

  // Bare decimal or hex: 2130706433, 0x7f000001
  if (parts.length === 1) {
    const value = toNumber(parts[0]);
    if (value === null || value < 0 || value > 0xffffffff) return null;
    return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
  }

  if (parts.length !== 4) return null;

  const octets = parts.map(toNumber);
  if (octets.some((o) => o === null || o < 0 || o > 255)) return null;
  return octets as [number, number, number, number];
}

/** Reserved IPv4 space that must never be reachable through this proxy. */
function ipv4Refusal(octets: [number, number, number, number]): string | null {
  const [a, b] = octets;

  if (a === 127) return 'loopback addresses are not permitted';
  if (a === 0) return 'the unspecified address is not permitted';
  if (a === 10) return 'private (RFC1918) addresses are not permitted';
  if (a === 172 && b >= 16 && b <= 31) return 'private (RFC1918) addresses are not permitted';
  if (a === 192 && b === 168) return 'private (RFC1918) addresses are not permitted';
  // 169.254.169.254 is the cloud metadata endpoint. Name it: a log line saying
  // "link-local" is far more actionable than "refused".
  if (a === 169 && b === 254) return 'link-local and cloud metadata addresses are not permitted';
  if (a === 255) return 'the broadcast address is not permitted';
  if (a >= 224) return 'multicast and reserved addresses are not permitted';

  return null;
}

/** Reserved IPv6 space. Hosts arrive from URL parsing already bracket-stripped. */
function ipv6Refusal(host: string): string | null {
  const address = host.toLowerCase();

  if (address === '::1' || address === '::') return 'loopback addresses are not permitted';
  // fc00::/7 — unique local
  if (/^f[cd][0-9a-f]{2}:/.test(address)) return 'private addresses are not permitted';
  // fe80::/10 — link-local
  if (/^fe[89ab][0-9a-f]:/.test(address)) {
    return 'link-local and cloud metadata addresses are not permitted';
  }
  // ::ffff:127.0.0.1 and friends — IPv4-mapped, which would otherwise slip past
  // both the IPv4 and IPv6 checks.
  const mapped = address.match(/^::ffff:(.+)$/);
  if (mapped) {
    const octets = parseIPv4(mapped[1]);
    if (octets) return ipv4Refusal(octets) ?? null;
  }

  return null;
}

/** Hostnames that are loopback by convention rather than by address. */
const LOOPBACK_NAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost']);

export function validateWmsUrl(input: string): WmsUrlValidation {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: 'not a valid absolute URL — include http:// or https://' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: `scheme "${url.protocol}" is not permitted — use http or https` };
  }

  // Credentials in the authority are refused outright rather than parsed around.
  // `http://example.org@127.0.0.1/` is host 127.0.0.1, but a guard reading the
  // string loosely sees example.org. URL already resolves this correctly; the
  // refusal is belt-and-braces and removes a whole class of ambiguity.
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'credentials in the URL are not permitted' };
  }

  // URL keeps IPv6 hosts bracketed; strip for comparison.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (host === '') {
    return { ok: false, reason: 'the URL has no host' };
  }

  if (LOOPBACK_NAMES.has(host)) {
    return { ok: false, reason: 'loopback addresses are not permitted' };
  }

  if (host.includes(':')) {
    const refusal = ipv6Refusal(host);
    if (refusal) return { ok: false, reason: refusal };
    return { ok: true, url };
  }

  const octets = parseIPv4(host);
  if (octets) {
    const refusal = ipv4Refusal(octets);
    if (refusal) return { ok: false, reason: refusal };
    return { ok: true, url };
  }

  // A hostname. Permitted — with the DNS-rebinding limitation declared in this
  // file's header. It is NOT resolved here, and this guard does not pretend to
  // be a proof that the eventual connection is safe.
  return { ok: true, url };
}
