/**
 * Layer Context — the context object and its value type.
 *
 * Separate from LayerProvider.tsx so that the provider file exports nothing
 * but a component. Vite's fast refresh can only hot-swap a module whose
 * exports are all components; a context object alongside them forces a full
 * reload and tears down state on every edit.
 */

import { createContext } from 'react';
import type {
  LayerConfig,
  GeoJSONLayerConfig,
  RasterLayerConfig,
  LayerState,
  LayerGroup,
} from '../types/layer';

/**
 * Layer context value
 */
export interface LayerContextValue {
  state: LayerState;
  addGeoJSONLayer: (config: Omit<GeoJSONLayerConfig, 'type'>) => void;
  addRasterLayer: (config: Omit<RasterLayerConfig, 'type'>) => void;
  removeLayer: (layerId: string) => void;
  updateLayer: (layerId: string, updates: Partial<LayerConfig>) => void;
  setOpacity: (layerId: string, opacity: number) => void;
  toggleVisibility: (layerId: string) => void;
  reorderLayer: (layerId: string, newIndex: number) => void;
  addGroup: (group: LayerGroup) => void;
  removeGroup: (groupId: string) => void;
  toggleGroupExpanded: (groupId: string) => void;
  selectLayer: (layerId: string | null) => void;
  clearLayers: () => void;
}

export const LayerContext = createContext<LayerContextValue | null>(null);
