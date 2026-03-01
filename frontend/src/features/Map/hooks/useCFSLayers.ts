/**
 * useCFSLayers Hook
 *
 * Manages CFS FireSTARR WMS layer configuration.
 * Fetches the CFS API key from the settings endpoint.
 * If key exists, returns available WMS layers and a URL builder.
 *
 * WMS base: https://app-geoserver-wips-cwfis-prod.azurewebsites.net/geoserver/firestarr/wms
 */

import { useState, useEffect, useCallback } from 'react';

const WMS_BASE = 'https://app-geoserver-wips-cwfis-prod.azurewebsites.net/geoserver/firestarr/wms';
const CFS_KEY = 'CFS_FIRESTARR_AUTHKEY';

export interface CFSLayerDef {
  /** Layer identifier in the WMS service */
  id: string;
  /** Human-readable display name */
  name: string;
  /** WMS layer name parameter */
  layerName: string;
}

export interface UseCFSLayersReturn {
  /** Whether an API key is configured and layers are available */
  available: boolean;
  /** The configured API key (null if not set) */
  apiKey: string | null;
  /** Available CFS WMS layer definitions */
  layers: CFSLayerDef[];
  /** Whether the key lookup is in progress */
  loading: boolean;
  /**
   * Build a WMS tile URL for a given layer and date.
   * Uses {bbox-epsg-3857} placeholder for Mapbox tile substitution.
   */
  buildWmsUrl: (layerName: string, date: string) => string;
}

/** Available CFS FireSTARR WMS layers */
const CFS_LAYERS: CFSLayerDef[] = [
  {
    id: 'cfs-cbmt',
    name: 'CBMT',
    layerName: 'firestarr:CBMT',
  },
  {
    id: 'cfs-firestarr',
    name: 'FireSTARR',
    layerName: 'firestarr:FireSTARR',
  },
];

/**
 * Build a WMS GetMap tile URL compatible with Mapbox GL raster source.
 * The {bbox-epsg-3857} placeholder must NOT be URL-encoded so Mapbox GL
 * can substitute the actual tile bounding box at render time.
 */
function buildWmsUrl(layerName: string, date: string, authKey: string): string {
  // Use URLSearchParams for regular params, then manually inject the bbox placeholder
  const params = new URLSearchParams({
    format: 'image/png',
    service: 'WMS',
    version: '1.1.1',
    request: 'GetMap',
    srs: 'EPSG:3857',
    transparent: 'true',
    width: '256',
    height: '256',
    layers: layerName,
    authkey: authKey,
    TIME: date,
  });

  // bbox placeholder must be literal (not URL-encoded) for Mapbox GL tile substitution
  return `${WMS_BASE}?bbox={bbox-epsg-3857}&${params.toString()}`;
}

/**
 * useCFSLayers — hook for CFS FireSTARR WMS layer management.
 *
 * @example
 * ```tsx
 * const { available, layers, buildWmsUrl } = useCFSLayers();
 * if (available) {
 *   const tileUrl = buildWmsUrl('firestarr:FireSTARR', '2026-03-01');
 * }
 * ```
 */
export function useCFSLayers(): UseCFSLayersReturn {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/v1/settings/${CFS_KEY}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { value?: string } | null) => {
        if (!cancelled) {
          setApiKey(data?.value ?? null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApiKey(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const buildUrl = useCallback(
    (layerName: string, date: string): string => {
      if (!apiKey) return '';
      return buildWmsUrl(layerName, date, apiKey);
    },
    [apiKey]
  );

  const available = !loading && apiKey !== null && apiKey.length > 0;

  return {
    available,
    apiKey,
    layers: available ? CFS_LAYERS : [],
    loading,
    buildWmsUrl: buildUrl,
  };
}
