import type { Map as MapLibreMap, LngLatLike, StyleSpecification } from 'maplibre-gl';

/**
 * Map initialization options
 */
export interface MapOptions {
  /** Initial center coordinates [lng, lat] */
  center?: LngLatLike;
  /** Initial zoom level (0-22) */
  zoom?: number;
  /** Map style URL or object */
  style?: string | StyleSpecification;
  /** Enable 3D terrain by default */
  terrain?: boolean;
  /** Terrain exaggeration (1.0 - 3.0) */
  terrainExaggeration?: number;
  /** Initial pitch in degrees (0-85) */
  pitch?: number;
  /** Initial bearing in degrees */
  bearing?: number;
}

/**
 * Map context value exposed to child components
 */
export interface MapContextValue {
  /** The MapLibre GL map instance */
  map: MapLibreMap | null;
  /** Whether the map has loaded */
  isLoaded: boolean;
  /** Whether the map is currently loading */
  isLoading: boolean;
  /** Any error that occurred during initialization */
  error: Error | null;
}

/**
 * Basemap style options
 */
export type BasemapStyle = 'streets' | 'satellite' | 'outdoors';

/**
 * Basemap configuration
 */
export interface BasemapConfig {
  id: BasemapStyle;
  name: string;
  url: string | StyleSpecification;
  thumbnail?: string;
}

/**
 * Mapbox access token from environment. When present, Mapbox styles are
 * used for higher-quality basemaps. When absent, free alternatives are used.
 */
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

/**
 * Free basemap styles (no API key required)
 */
const FREE_BASEMAPS: Record<BasemapStyle, BasemapConfig> = {
  streets: {
    id: 'streets',
    name: 'Streets',
    url: 'https://tiles.openfreemap.org/styles/liberty',
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite',
    url: {
      version: 8,
      sources: {
        'esri-satellite': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          attribution: 'Tiles &copy; Esri',
          maxzoom: 19,
        },
        'esri-labels': {
          type: 'raster',
          tiles: [
            'https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
        },
      },
      layers: [
        {
          id: 'esri-satellite-layer',
          type: 'raster',
          source: 'esri-satellite',
        },
        {
          id: 'esri-labels-layer',
          type: 'raster',
          source: 'esri-labels',
        },
      ],
    } as StyleSpecification,
  },
  outdoors: {
    id: 'outdoors',
    name: 'Outdoors',
    url: 'https://tiles.openfreemap.org/styles/bright',
  },
};

/**
 * Mapbox basemap styles (requires VITE_MAPBOX_TOKEN in .env)
 */
function mapboxBasemaps(token: string): Record<BasemapStyle, BasemapConfig> {
  return {
    streets: {
      id: 'streets',
      name: 'Streets',
      url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${token}`,
    },
    satellite: {
      id: 'satellite',
      name: 'Satellite',
      url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12?access_token=${token}`,
    },
    outdoors: {
      id: 'outdoors',
      name: 'Outdoors',
      url: `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12?access_token=${token}`,
    },
  };
}

/**
 * Available basemap styles.
 * Uses Mapbox when VITE_MAPBOX_TOKEN is set, free alternatives otherwise.
 */
export const BASEMAP_STYLES: Record<BasemapStyle, BasemapConfig> =
  MAPBOX_TOKEN ? mapboxBasemaps(MAPBOX_TOKEN) : FREE_BASEMAPS;

/**
 * Default map options for fire modeling context (Canada-focused)
 */
export const DEFAULT_MAP_OPTIONS: Required<MapOptions> = {
  center: [-106.0, 56.0], // Central Canada
  zoom: 4,
  style: BASEMAP_STYLES.outdoors.url,
  terrain: true,
  terrainExaggeration: 1.4,
  pitch: 0,
  bearing: 0,
};
