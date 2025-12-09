import type { FeatureCollection } from 'geojson';

/**
 * Layer types supported by the map
 */
export type LayerType = 'geojson' | 'raster';

/**
 * Breaks mode for probability layers
 * - static: Fixed 10% intervals (FireSTARR standard)
 * - dynamic: Quantile breaks from actual data
 */
export type BreaksMode = 'static' | 'dynamic';

/**
 * Layer visibility state
 */
export type LayerVisibility = 'visible' | 'none';

/**
 * Base layer configuration
 */
export interface BaseLayerConfig {
  /** Unique layer ID */
  id: string;
  /** Display name */
  name: string;
  /** Layer type */
  type: LayerType;
  /** Opacity (0-1) */
  opacity: number;
  /** Visibility */
  visible: boolean;
  /** Z-order (higher = on top) */
  zIndex: number;
  /** Optional group ID for organizing layers */
  groupId?: string;
  /** Breaks mode for probability layers (static/dynamic) */
  breaksMode?: BreaksMode;
  /** Result ID for persistence/reload (references backend model result) */
  resultId?: string;
  /** Output type for persistence (e.g., 'probability', 'intensity') */
  outputType?: string;
}

/**
 * GeoJSON layer configuration
 */
export interface GeoJSONLayerConfig extends BaseLayerConfig {
  type: 'geojson';
  /** GeoJSON data */
  data: FeatureCollection;
  /** Fill color (for polygons) - ignored if useFeatureColors is true */
  fillColor?: string;
  /** Stroke/line color - ignored if useFeatureColors is true */
  strokeColor?: string;
  /** Stroke width */
  strokeWidth?: number;
  /** Fill opacity */
  fillOpacity?: number;
  /** Use color from feature properties instead of single color */
  useFeatureColors?: boolean;
}

/**
 * Raster layer configuration
 */
export interface RasterLayerConfig extends BaseLayerConfig {
  type: 'raster';
  /** Tile URL template or URL array */
  url: string | string[];
  /** Tile size (usually 256 or 512) */
  tileSize?: number;
  /** Bounds [west, south, east, north] */
  bounds?: [number, number, number, number];
}

/**
 * Union type for all layer configurations
 */
export type LayerConfig = GeoJSONLayerConfig | RasterLayerConfig;

/**
 * Layer group for organizing related layers
 */
export interface LayerGroup {
  /** Unique group ID */
  id: string;
  /** Display name */
  name: string;
  /** Whether group is expanded in UI */
  expanded: boolean;
}

/**
 * Layer state for management
 */
export interface LayerState {
  /** All layers */
  layers: LayerConfig[];
  /** Layer groups */
  groups: LayerGroup[];
  /** Selected layer ID */
  selectedLayerId: string | null;
}

/**
 * Default layer style presets for fire modeling outputs
 */
export const LAYER_PRESETS = {
  firePerimeter: {
    fillColor: '#ff6b35',
    strokeColor: '#d84315',
    strokeWidth: 2,
    fillOpacity: 0.3,
  },
  burnProbability: {
    fillColor: '#ffeb3b',
    strokeColor: '#f57f17',
    strokeWidth: 1,
    fillOpacity: 0.5,
  },
  intensityGrid: {
    fillColor: '#f44336',
    strokeColor: '#b71c1c',
    strokeWidth: 1,
    fillOpacity: 0.6,
  },
  emberZone: {
    fillColor: '#ff9800',
    strokeColor: '#e65100',
    strokeWidth: 1,
    fillOpacity: 0.4,
  },
} as const;
