import type { Map as MapboxMap, LngLatLike, StyleSpecification } from 'mapbox-gl';

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
  /** The Mapbox GL map instance */
  map: MapboxMap | null;
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
  url: string;
  thumbnail?: string;
}

/**
 * Available basemap styles
 */
export const BASEMAP_STYLES: Record<BasemapStyle, BasemapConfig> = {
  streets: {
    id: 'streets',
    name: 'Streets',
    url: 'mapbox://styles/mapbox/streets-v12',
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite',
    url: 'mapbox://styles/mapbox/satellite-streets-v12',
  },
  outdoors: {
    id: 'outdoors',
    name: 'Outdoors',
    url: 'mapbox://styles/mapbox/outdoors-v12',
  },
};

/**
 * Default map options for fire modeling context (Canada-focused)
 */
export const DEFAULT_MAP_OPTIONS: Required<MapOptions> = {
  center: [-106.0, 56.0], // Central Canada
  zoom: 4,
  style: BASEMAP_STYLES.outdoors.url,
  terrain: false,
  terrainExaggeration: 1.5,
  pitch: 0,
  bearing: 0,
};
