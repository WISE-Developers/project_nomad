/**
 * WMS URL building for user-supplied servers (#315).
 *
 * Nomad already builds WMS GetMap URLs in `useCwfisM3Layers` and `useCFSLayers`,
 * both hardcoding `version: '1.1.1'` and `srs: 'EPSG:3857'`. Correct for those
 * two servers; wrong as a general assumption. Every capabilities document read
 * while assessing #315 declares **WMS 1.3.0**, which renamed `srs` to `crs`.
 *
 * ON AXIS ORDER, because the assessment flagged it and it does NOT apply here:
 * 1.3.0 reverses axis order only for CRSs the authority defines as lat/lon —
 * EPSG:4326 is one; EPSG:3857 is defined easting/northing and is unaffected.
 * MapLibre substitutes `{bbox-epsg-3857}`, so every URL built here is on a
 * projected CRS and the ordering is identical across versions. Do not "fix" an
 * axis flip here — doing so would introduce the bug the warning is named after.
 */

/** The two versions real servers speak. */
export type WmsVersion = '1.1.1' | '1.3.0';

export interface WmsUrlOptions {
  /** The service endpoint, with or without its own query parameters. */
  serviceUrl: string;
  /** Layer name as the server publishes it, e.g. `nrcan:canvec_hydro`. */
  layer: string;
  /** Defaults to 1.3.0 — what real servers declare. */
  version?: WmsVersion;
  /** Defaults to a transparent PNG. */
  format?: string;
}

/**
 * MapLibre substitutes tile bounds into this token. It MUST survive unencoded:
 * `URLSearchParams` would percent-encode the braces, the substitution would
 * never happen, and the server would receive the literal string — producing a
 * blank layer with a 200 rather than an error anyone could see.
 */
const BBOX_PLACEHOLDER = '{bbox-epsg-3857}';

/** Always projected, which is why axis order never varies here. */
const CRS = 'EPSG:3857';

/**
 * Parameters this module sets itself. Anything here that arrives on the service
 * URL is DROPPED, because the one we are about to append is the correct one.
 *
 * Everything NOT on this list survives untouched — a MapServer endpoint is
 * useless without its `map=`, so stripping the whole query would trade one
 * broken feature for another.
 */
const OWNED_PARAMS = new Set([
  'service',
  'request',
  'version',
  'crs',
  'srs',
  'format',
  'transparent',
  'width',
  'height',
  'styles',
  'layers',
  'layer',
  'bbox',
]);

/**
 * Joins query parameters onto a service URL that may already carry some.
 *
 * Services are routinely handed out with parameters attached — a MapServer
 * endpoint ending `?map=/data/fire.map`, for instance. A naive `${url}?${params}`
 * produces two `?` and the server parses none of ours.
 *
 * AND A URL MAY ALREADY CARRY A PARAMETER WE ALSO SET (#315 follow-up). The
 * obvious thing for a user to paste is the GetCapabilities URL — it is what the
 * "Read catalogue" step asks for — which ends `?request=getCapabilities`.
 * Appending our own `request=GetMap` left `request` in the URL TWICE; the
 * server picked one, and on the live CIFFC demo every legend rendered broken.
 *
 * Earlier coverage used `?map=/data/fire.map`, a parameter we do not set, so no
 * collision was ever exercised and a green suite shipped the defect.
 *
 * Kept pairs are copied VERBATIM rather than round-tripped through
 * `URLSearchParams`, which would re-encode them — `map=/data/fire.map` would
 * become `map=%2Fdata%2Ffire.map`. Encoding values that servers accept literally
 * has broken real endpoints before, which is the same reason `layers` is
 * appended by hand below.
 */
function joinQuery(serviceUrl: string, query: string): string {
  const queryStart = serviceUrl.indexOf('?');
  if (queryStart === -1) {
    return `${serviceUrl}?${query}`;
  }

  const base = serviceUrl.slice(0, queryStart);
  const kept = serviceUrl
    .slice(queryStart + 1)
    .split('&')
    .filter((pair) => pair.length > 0)
    .filter((pair) => !OWNED_PARAMS.has(pair.split('=')[0].toLowerCase()));

  return kept.length > 0 ? `${base}?${kept.join('&')}&${query}` : `${base}?${query}`;
}

/** The CRS parameter name, which is the whole substantive difference. */
function crsParam(version: WmsVersion): string {
  return version === '1.3.0' ? 'crs' : 'srs';
}

/**
 * A GetMap tile URL template for a MapLibre raster source.
 *
 * The bbox is emitted first and by hand, outside `URLSearchParams`, so the
 * placeholder stays literal.
 */
export function buildWmsTileUrl(options: WmsUrlOptions): string {
  const { serviceUrl, layer, version = '1.3.0', format = 'image/png' } = options;

  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version,
    [crsParam(version)]: CRS,
    format,
    transparent: 'true',
    width: '256',
    height: '256',
    styles: '',
  });

  // `layers` is appended literally: a namespaced name like `nrcan:canvec_hydro`
  // is accepted by servers with the colon intact, and encoding it has broken
  // real endpoints before (same reason useCwfisM3Layers keeps it literal).
  return joinQuery(serviceUrl, `bbox=${BBOX_PLACEHOLDER}&layers=${layer}&${params.toString()}`);
}

/**
 * A GetLegendGraphic URL for the same layer.
 *
 * Note the SINGULAR `layer=`. GetMap takes `layers`; GetLegendGraphic takes
 * `layer`, and sending the plural returns a legend for nothing.
 */
export function buildWmsLegendUrl(options: WmsUrlOptions): string {
  const { serviceUrl, layer, version = '1.3.0', format = 'image/png' } = options;

  const params = new URLSearchParams({
    service: 'WMS',
    request: 'GetLegendGraphic',
    version,
    format,
    transparent: 'true',
  });

  return joinQuery(serviceUrl, `layer=${layer}&${params.toString()}`);
}
