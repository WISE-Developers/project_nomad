import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import mapboxgl from 'mapbox-gl';
import { useMap } from './MapContext';
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
interface LayerContextValue {
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

const LayerContext = createContext<LayerContextValue | null>(null);

/** Local storage key for layer persistence */
const LAYERS_STORAGE_KEY = 'nomad-layers';

/**
 * Layer metadata for persistence (excludes large GeoJSON data)
 */
interface PersistedLayerMeta {
  id: string;
  name: string;
  type: 'geojson' | 'raster';
  resultId?: string;
  outputType?: string;
  breaksMode?: 'static' | 'dynamic';
  visible: boolean;
  opacity: number;
  zIndex: number;
}

/**
 * Provider for shared layer state
 */
export function LayerProvider({ children }: { children: ReactNode }) {
  const { map, isLoaded } = useMap();
  const [state, setState] = useState<LayerState>({
    layers: [],
    groups: [],
    selectedLayerId: null,
  });

  // Track if we've already restored from localStorage
  const hasRestoredRef = useRef(false);

  // Popup for hover tooltips
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  // Track current layers state for style.load handler (avoids stale closure)
  const layersRef = useRef(state.layers);
  useEffect(() => {
    layersRef.current = state.layers;
  }, [state.layers]);

  // Initialize popup
  useEffect(() => {
    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'probability-popup',
      });
    }
    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
      }
    };
  }, []);

  // Restore layers when map style changes (e.g., basemap switch)
  useEffect(() => {
    if (!map) return;

    const handleStyleLoad = () => {
      const layers = layersRef.current;
      if (layers.length === 0) return;

      console.log(`[LayerContext] Style loaded, restoring ${layers.length} layers`);

      layers.forEach((layer) => {
        // Skip if layer already exists (style.load can fire on initial load too)
        if (map.getSource(layer.id)) return;

        if (layer.type === 'geojson') {
          const gjLayer = layer as GeoJSONLayerConfig;

          // Re-add source
          map.addSource(layer.id, {
            type: 'geojson',
            data: gjLayer.data,
          });

          // Determine color expressions
          const fillColorExpr = gjLayer.useFeatureColors
            ? ['coalesce', ['get', 'color'], gjLayer.fillColor || '#3388ff']
            : gjLayer.fillColor || '#3388ff';
          const strokeColorExpr = gjLayer.useFeatureColors
            ? ['coalesce', ['get', 'color'], gjLayer.strokeColor || '#3388ff']
            : gjLayer.strokeColor || '#3388ff';

          // Re-add fill layer
          map.addLayer({
            id: `${layer.id}-fill`,
            type: 'fill',
            source: layer.id,
            paint: {
              'fill-color': fillColorExpr as string,
              'fill-opacity': (gjLayer.opacity ?? 1) * (gjLayer.fillOpacity ?? 0.5),
            },
            filter: ['==', '$type', 'Polygon'],
            layout: {
              visibility: gjLayer.visible ? 'visible' : 'none',
            },
          });

          // Re-add line layer
          map.addLayer({
            id: `${layer.id}-line`,
            type: 'line',
            source: layer.id,
            paint: {
              'line-color': strokeColorExpr as string,
              'line-width': gjLayer.strokeWidth || 2,
              'line-opacity': gjLayer.opacity ?? 1,
            },
            layout: {
              visibility: gjLayer.visible ? 'visible' : 'none',
            },
          });

          // Re-add point layer
          map.addLayer({
            id: `${layer.id}-point`,
            type: 'circle',
            source: layer.id,
            paint: {
              'circle-color': gjLayer.fillColor || '#3388ff',
              'circle-radius': 6,
              'circle-opacity': gjLayer.opacity ?? 1,
              'circle-stroke-color': gjLayer.strokeColor || '#ffffff',
              'circle-stroke-width': 2,
            },
            filter: ['==', '$type', 'Point'],
            layout: {
              visibility: gjLayer.visible ? 'visible' : 'none',
            },
          });
        } else if (layer.type === 'raster') {
          const rasterLayer = layer as RasterLayerConfig;

          // Re-add raster source
          map.addSource(layer.id, {
            type: 'raster',
            tiles: Array.isArray(rasterLayer.url) ? rasterLayer.url : [rasterLayer.url],
            tileSize: rasterLayer.tileSize || 256,
            bounds: rasterLayer.bounds,
          });

          // Re-add raster layer
          map.addLayer({
            id: layer.id,
            type: 'raster',
            source: layer.id,
            paint: {
              'raster-opacity': rasterLayer.opacity ?? 1,
            },
            layout: {
              visibility: rasterLayer.visible ? 'visible' : 'none',
            },
          });
        }
      });
    };

    map.on('style.load', handleStyleLoad);
    return () => {
      map.off('style.load', handleStyleLoad);
    };
  }, [map]);

  // Sync layer changes with map
  useEffect(() => {
    if (!map || !isLoaded) return;

    state.layers.forEach((layer) => {
      // Check for any of the sub-layers
      const hasLayer = map.getLayer(layer.id)
        || map.getLayer(`${layer.id}-fill`)
        || map.getLayer(`${layer.id}-line`)
        || map.getLayer(`${layer.id}-point`);

      if (hasLayer) {
        // Update visibility for all sub-layers
        [`${layer.id}-fill`, `${layer.id}-line`, `${layer.id}-point`, layer.id].forEach((id) => {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', layer.visible ? 'visible' : 'none');
          }
        });

        // Update opacity
        if (layer.type === 'geojson') {
          const fillLayerId = `${layer.id}-fill`;
          const lineLayerId = `${layer.id}-line`;
          const pointLayerId = `${layer.id}-point`;
          if (map.getLayer(fillLayerId)) {
            map.setPaintProperty(fillLayerId, 'fill-opacity', layer.opacity * (layer.fillOpacity ?? 1));
          }
          if (map.getLayer(lineLayerId)) {
            map.setPaintProperty(lineLayerId, 'line-opacity', layer.opacity);
          }
          if (map.getLayer(pointLayerId)) {
            map.setPaintProperty(pointLayerId, 'circle-opacity', layer.opacity);
          }
        } else if (layer.type === 'raster') {
          map.setPaintProperty(layer.id, 'raster-opacity', layer.opacity);
        }
      }
    });
  }, [map, isLoaded, state.layers]);

  // Persist layer metadata to localStorage when layers change
  useEffect(() => {
    // Don't persist empty state during initial load
    if (state.layers.length === 0 && !hasRestoredRef.current) return;

    const layerMeta: PersistedLayerMeta[] = state.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      resultId: layer.resultId,
      outputType: layer.outputType,
      breaksMode: layer.breaksMode,
      visible: layer.visible,
      opacity: layer.opacity,
      zIndex: layer.zIndex,
    }));
    localStorage.setItem(LAYERS_STORAGE_KEY, JSON.stringify(layerMeta));
  }, [state.layers]);

  // Restore layers from localStorage on initial load
  useEffect(() => {
    if (hasRestoredRef.current || !isLoaded) return;
    hasRestoredRef.current = true;

    const saved = localStorage.getItem(LAYERS_STORAGE_KEY);
    if (!saved) return;

    try {
      const layerMetas: PersistedLayerMeta[] = JSON.parse(saved);
      console.log(`[LayerContext] Restoring ${layerMetas.length} layers from localStorage`);

      // Fetch and restore each layer that has a resultId
      layerMetas.forEach(async (meta) => {
        if (meta.resultId && meta.type === 'geojson') {
          try {
            const mode = meta.breaksMode || 'dynamic';
            const res = await fetch(`/api/v1/results/${meta.resultId}/preview?mode=${mode}`);
            if (!res.ok) {
              console.warn(`[LayerContext] Failed to restore layer ${meta.name}: ${res.status}`);
              return;
            }
            const geojson = await res.json();

            // Add the layer with restored metadata
            // Note: We call setState directly to avoid infinite loop with addGeoJSONLayer
            if (map && !map.getSource(meta.id)) {
              // Determine colors from feature data
              const hasFeatureColors =
                geojson.type === 'FeatureCollection' &&
                geojson.features?.some((f: GeoJSON.Feature) => f.properties?.color);

              map.addSource(meta.id, { type: 'geojson', data: geojson });

              // Add fill layer
              map.addLayer({
                id: `${meta.id}-fill`,
                type: 'fill',
                source: meta.id,
                paint: {
                  'fill-color': hasFeatureColors
                    ? ['coalesce', ['get', 'color'], '#3388ff']
                    : '#3388ff',
                  'fill-opacity': (meta.opacity ?? 1) * 0.5,
                },
                filter: ['==', '$type', 'Polygon'],
                layout: { visibility: meta.visible ? 'visible' : 'none' },
              });

              // Add line layer
              map.addLayer({
                id: `${meta.id}-line`,
                type: 'line',
                source: meta.id,
                paint: {
                  'line-color': hasFeatureColors
                    ? ['coalesce', ['get', 'color'], '#3388ff']
                    : '#3388ff',
                  'line-width': 2,
                  'line-opacity': meta.opacity ?? 1,
                },
                layout: { visibility: meta.visible ? 'visible' : 'none' },
              });

              // Add point layer
              map.addLayer({
                id: `${meta.id}-point`,
                type: 'circle',
                source: meta.id,
                paint: {
                  'circle-color': '#3388ff',
                  'circle-radius': 6,
                  'circle-opacity': meta.opacity ?? 1,
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 2,
                },
                filter: ['==', '$type', 'Point'],
                layout: { visibility: meta.visible ? 'visible' : 'none' },
              });

              // Update state
              setState((prev) => ({
                ...prev,
                layers: [
                  ...prev.layers,
                  {
                    ...meta,
                    type: 'geojson' as const,
                    data: geojson,
                    useFeatureColors: hasFeatureColors,
                    fillOpacity: 0.5,
                    strokeWidth: 2,
                  },
                ],
              }));

              console.log(`[LayerContext] Restored layer: ${meta.name}`);
            }
          } catch (err) {
            console.warn(`[LayerContext] Error restoring layer ${meta.name}:`, err);
          }
        }
      });
    } catch (err) {
      console.warn('[LayerContext] Failed to parse stored layers:', err);
      localStorage.removeItem(LAYERS_STORAGE_KEY);
    }
  }, [isLoaded, map]);

  const addGeoJSONLayer = useCallback(
    (config: Omit<GeoJSONLayerConfig, 'type'>) => {
      if (!map || !isLoaded) return;

      const layerConfig: GeoJSONLayerConfig = {
        ...config,
        type: 'geojson',
      };

      // Add source
      if (!map.getSource(config.id)) {
        map.addSource(config.id, {
          type: 'geojson',
          data: config.data,
        });
      }

      // Determine color expression - data-driven or static
      const fillColorExpr = config.useFeatureColors
        ? ['coalesce', ['get', 'color'], config.fillColor || '#3388ff']
        : config.fillColor || '#3388ff';
      const strokeColorExpr = config.useFeatureColors
        ? ['coalesce', ['get', 'color'], config.strokeColor || '#3388ff']
        : config.strokeColor || '#3388ff';

      // Add fill layer for polygons
      if (!map.getLayer(`${config.id}-fill`)) {
        map.addLayer({
          id: `${config.id}-fill`,
          type: 'fill',
          source: config.id,
          paint: {
            'fill-color': fillColorExpr as string,
            'fill-opacity': (config.opacity ?? 1) * (config.fillOpacity ?? 0.5),
          },
          filter: ['==', '$type', 'Polygon'],
        });
      }

      // Add line layer for lines and polygon outlines
      if (!map.getLayer(`${config.id}-line`)) {
        map.addLayer({
          id: `${config.id}-line`,
          type: 'line',
          source: config.id,
          paint: {
            'line-color': strokeColorExpr as string,
            'line-width': config.strokeWidth || 2,
            'line-opacity': config.opacity ?? 1,
          },
        });
      }

      // Add circle layer for points
      if (!map.getLayer(`${config.id}-point`)) {
        map.addLayer({
          id: `${config.id}-point`,
          type: 'circle',
          source: config.id,
          paint: {
            'circle-color': config.fillColor || '#3388ff',
            'circle-radius': 6,
            'circle-opacity': config.opacity ?? 1,
            'circle-stroke-color': config.strokeColor || '#ffffff',
            'circle-stroke-width': 2,
          },
          filter: ['==', '$type', 'Point'],
        });
      }

      // Add hover tooltip for layers with feature colors (e.g., probability polygons)
      if (config.useFeatureColors) {
        const fillLayerId = `${config.id}-fill`;

        // Change cursor on hover
        map.on('mouseenter', fillLayerId, () => {
          map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', fillLayerId, () => {
          map.getCanvas().style.cursor = '';
          if (popupRef.current) {
            popupRef.current.remove();
          }
        });

        map.on('mousemove', fillLayerId, (e) => {
          if (e.features && e.features[0] && popupRef.current) {
            const props = e.features[0].properties;
            if (props) {
              // Format probability as percentage
              const probability = props.probability;
              const label = props.label || (probability !== undefined ? `${(probability * 100).toFixed(1)}%` : 'Unknown');

              popupRef.current
                .setLngLat(e.lngLat)
                .setHTML(`<strong>Burn Probability:</strong> ${label}`)
                .addTo(map);
            }
          }
        });
      }

      setState((prev) => ({
        ...prev,
        layers: [...prev.layers, layerConfig],
      }));
    },
    [map, isLoaded]
  );

  const addRasterLayer = useCallback(
    (config: Omit<RasterLayerConfig, 'type'>) => {
      if (!map || !isLoaded) return;

      const layerConfig: RasterLayerConfig = {
        ...config,
        type: 'raster',
      };

      if (!map.getSource(config.id)) {
        map.addSource(config.id, {
          type: 'raster',
          tiles: Array.isArray(config.url) ? config.url : [config.url],
          tileSize: config.tileSize || 256,
          bounds: config.bounds,
        });
      }

      if (!map.getLayer(config.id)) {
        map.addLayer({
          id: config.id,
          type: 'raster',
          source: config.id,
          paint: {
            'raster-opacity': config.opacity ?? 1,
          },
        });
      }

      setState((prev) => ({
        ...prev,
        layers: [...prev.layers, layerConfig],
      }));
    },
    [map, isLoaded]
  );

  const removeLayer = useCallback(
    (layerId: string) => {
      if (!map) return;

      [`${layerId}-fill`, `${layerId}-line`, `${layerId}-point`, layerId].forEach((id) => {
        if (map.getLayer(id)) {
          map.removeLayer(id);
        }
      });

      if (map.getSource(layerId)) {
        map.removeSource(layerId);
      }

      setState((prev) => ({
        ...prev,
        layers: prev.layers.filter((l) => l.id !== layerId),
        selectedLayerId: prev.selectedLayerId === layerId ? null : prev.selectedLayerId,
      }));
    },
    [map]
  );

  const updateLayer = useCallback(
    (layerId: string, updates: Partial<Omit<LayerConfig, 'type'>>) => {
      setState((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === layerId ? { ...l, ...updates } as LayerConfig : l
        ),
      }));
    },
    []
  );

  const setOpacity = useCallback(
    (layerId: string, opacity: number) => {
      updateLayer(layerId, { opacity: Math.max(0, Math.min(1, opacity)) });
    },
    [updateLayer]
  );

  const toggleVisibility = useCallback((layerId: string) => {
    setState((prev) => ({
      ...prev,
      layers: prev.layers.map((l) =>
        l.id === layerId ? { ...l, visible: !l.visible } : l
      ),
    }));
  }, []);

  const reorderLayer = useCallback((layerId: string, newIndex: number) => {
    setState((prev) => {
      const layers = [...prev.layers];
      const currentIndex = layers.findIndex((l) => l.id === layerId);
      if (currentIndex === -1) return prev;

      const [layer] = layers.splice(currentIndex, 1);
      layers.splice(newIndex, 0, layer);

      const updated = layers.map((l, i) => ({ ...l, zIndex: i }));
      return { ...prev, layers: updated };
    });
  }, []);

  const addGroup = useCallback((group: LayerGroup) => {
    setState((prev) => ({
      ...prev,
      groups: [...prev.groups, group],
    }));
  }, []);

  const removeGroup = useCallback((groupId: string) => {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.filter((g) => g.id !== groupId),
      layers: prev.layers.map((l) =>
        l.groupId === groupId ? { ...l, groupId: undefined } : l
      ),
    }));
  }, []);

  const toggleGroupExpanded = useCallback((groupId: string) => {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId ? { ...g, expanded: !g.expanded } : g
      ),
    }));
  }, []);

  const selectLayer = useCallback((layerId: string | null) => {
    setState((prev) => ({ ...prev, selectedLayerId: layerId }));
  }, []);

  const clearLayers = useCallback(() => {
    state.layers.forEach((layer) => removeLayer(layer.id));
  }, [state.layers, removeLayer]);

  return (
    <LayerContext.Provider
      value={{
        state,
        addGeoJSONLayer,
        addRasterLayer,
        removeLayer,
        updateLayer,
        setOpacity,
        toggleVisibility,
        reorderLayer,
        addGroup,
        removeGroup,
        toggleGroupExpanded,
        selectLayer,
        clearLayers,
      }}
    >
      {children}
    </LayerContext.Provider>
  );
}

/**
 * Hook to access layer context
 */
export function useLayers() {
  const context = useContext(LayerContext);
  if (!context) {
    throw new Error('useLayers must be used within a LayerProvider');
  }
  return context;
}
