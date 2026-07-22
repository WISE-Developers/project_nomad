/**
 * useCwfisM3Layers Hook (Nomad #299)
 *
 * Exposes the CWFIS FireM3 public WMS layers for heads-up modelling:
 *   - M3 Hotspots  (public:hotspots)  — temporal, filtered to the current season
 *   - M3 Perimeters (public:m3polygons) — fire perimeter estimate polygons
 *
 * These come from NRCan's public CWFIS GeoServer, which requires NO auth key
 * (Fees / AccessConstraints = NONE). Rendered as WMS raster tiles, so there is
 * no CORS concern and no backend proxy is needed for this starting point.
 *
 * WMS base: https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows
 */

const WMS_BASE = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows';

export interface CwfisM3LayerDef {
  /** Stable internal layer identifier */
  id: string;
  /** Human-readable display name (shown in LayerPanel) */
  name: string;
  /** WMS layer name parameter */
  layerName: string;
  /** Whether the layer is time-filtered (hotspots) vs. static (perimeters) */
  temporal: boolean;
}

export interface UseCwfisM3LayersReturn {
  /** Always true — the CWFIS public service needs no key */
  available: boolean;
  /** Available CWFIS M3 WMS layer definitions */
  layers: CwfisM3LayerDef[];
  /** Build a WMS tile URL for a given layer (optionally time-filtered) */
  buildWmsUrl: (layerName: string, opts?: { time?: string }) => string;
  /** Build a WMS GetLegendGraphic image URL for a given layer */
  buildLegendUrl: (layerName: string) => string;
}

/** The two M3 layers offered by #299 */
const CWFIS_M3_LAYERS: CwfisM3LayerDef[] = [
  {
    id: 'cwfis-m3-hotspots',
    name: 'M3 Hotspots',
    layerName: 'public:hotspots',
    temporal: true,
  },
  {
    id: 'cwfis-m3-perimeters',
    name: 'M3 Perimeters',
    layerName: 'public:m3polygons',
    temporal: false,
  },
];

/**
 * Format a Date as YYYY-MM-DD (UTC).
 */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Current fire-season TIME range for the WMS `TIME` param.
 *
 * Season = Jan 1 of the current year → the given date (default: today).
 * Franco's convention (2026-07-22): calendar-year range, not operational
 * season-start.
 *
 * @example currentSeasonTime(new Date('2026-07-22')) // "2026-01-01/2026-07-22"
 */
export function currentSeasonTime(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  return `${year}-01-01/${isoDay(now)}`;
}

/**
 * Build a WMS GetMap tile URL compatible with a MapLibre GL raster source.
 *
 * The {bbox-epsg-3857} placeholder must NOT be URL-encoded so MapLibre GL can
 * substitute the actual tile bounding box at render time. No auth key is added —
 * the CWFIS public endpoint is open.
 *
 * @param layerName WMS layer (e.g. "public:hotspots")
 * @param opts.time optional WMS TIME value/range (applied only when present)
 */
export function buildCwfisWmsUrl(
  layerName: string,
  opts?: { time?: string }
): string {
  if (!layerName) {
    // Fail-fast: a missing layer name is a programming error, not a default.
    throw new Error('buildCwfisWmsUrl: layerName is required');
  }

  const params = new URLSearchParams({
    format: 'image/png',
    service: 'WMS',
    version: '1.1.1',
    request: 'GetMap',
    srs: 'EPSG:3857',
    transparent: 'true',
    width: '256',
    height: '256',
  });

  if (opts?.time) {
    params.set('TIME', opts.time);
  }

  // bbox placeholder and the namespaced layer name are kept literal (not
  // URL-encoded): the bbox so MapLibre GL can substitute the tile bounds, and
  // the "namespace:layer" colon to match the conventional WMS tile form.
  return `${WMS_BASE}?bbox={bbox-epsg-3857}&layers=${layerName}&${params.toString()}`;
}

/**
 * Build a WMS GetLegendGraphic image URL for a layer.
 *
 * GeoServer renders the layer's SLD symbology as a PNG legend swatch. Uses the
 * singular `layer=` param (GetLegendGraphic convention) and keeps the namespaced
 * layer name literal.
 */
export function buildCwfisLegendUrl(layerName: string): string {
  if (!layerName) {
    throw new Error('buildCwfisLegendUrl: layerName is required');
  }

  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetLegendGraphic',
    format: 'image/png',
    transparent: 'true',
  });

  return `${WMS_BASE}?layer=${layerName}&${params.toString()}`;
}

/**
 * useCwfisM3Layers — hook exposing the CWFIS M3 public WMS layers.
 *
 * @example
 * ```tsx
 * const { layers, buildWmsUrl } = useCwfisM3Layers();
 * const hotspotUrl = buildWmsUrl('public:hotspots', { time: currentSeasonTime() });
 * ```
 */
export function useCwfisM3Layers(): UseCwfisM3LayersReturn {
  return {
    available: true,
    layers: CWFIS_M3_LAYERS,
    buildWmsUrl: buildCwfisWmsUrl,
    buildLegendUrl: buildCwfisLegendUrl,
  };
}
