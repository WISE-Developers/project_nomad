/**
 * Map Feature Module
 *
 * Provides MapBox GL-based mapping components for fire modeling visualization.
 */

// Components
export { MapContainer } from './components/MapContainer';
export { DrawingToolbar } from './components/DrawingToolbar';
export { LayerPanel } from './components/LayerPanel';
export { LayerItem } from './components/LayerItem';
export { BasemapSwitcher } from './components/BasemapSwitcher';
export { MeasurementTool } from './components/MeasurementTool';
export { TerrainControl } from './components/TerrainControl';

// Context
export { MapProvider, useMap } from './context/MapContext';

// Hooks
export { useDrawing } from './hooks/useDrawing';
export { useLayers } from './hooks/useLayers';
export { useMeasurement } from './hooks/useMeasurement';
export { useTerrain } from './hooks/useTerrain';

// Types
export type {
  MapOptions,
  MapContextValue,
  BasemapStyle,
  BasemapConfig,
} from './types';

export type {
  DrawingMode,
  DrawEventType,
  PointFeature,
  LineFeature,
  PolygonFeature,
  DrawnFeature,
  DrawEvent,
  DrawingState,
  DrawingStyles,
} from './types/geometry';

export type {
  LayerType,
  LayerVisibility,
  BaseLayerConfig,
  GeoJSONLayerConfig,
  RasterLayerConfig,
  LayerConfig,
  LayerGroup,
  LayerState,
} from './types/layer';

export { BASEMAP_STYLES, DEFAULT_MAP_OPTIONS } from './types';
export { DEFAULT_DRAWING_STYLES } from './types/geometry';
export { LAYER_PRESETS } from './types/layer';
