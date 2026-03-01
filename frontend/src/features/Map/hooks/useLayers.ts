import { useCallback, useState, useEffect } from 'react';
import { useMap } from '../context/MapContext';
import type {
  LayerConfig,
  GeoJSONLayerConfig,
  RasterLayerConfig,
  LayerState,
  LayerGroup,
} from '../types/layer';

/**
 * Hook return value
 */
interface UseLayersReturn {
  /** Current layer state */
  state: LayerState;
  /** Add a GeoJSON layer */
  addGeoJSONLayer: (config: Omit<GeoJSONLayerConfig, 'type'>) => void;
  /** Add a raster layer (resolves when tiles are loaded) */
  addRasterLayer: (config: Omit<RasterLayerConfig, 'type'>) => Promise<void>;
  /** Remove a layer */
  removeLayer: (layerId: string) => void;
  /** Update layer properties */
  updateLayer: (layerId: string, updates: Partial<LayerConfig>) => void;
  /** Set layer opacity */
  setOpacity: (layerId: string, opacity: number) => void;
  /** Toggle layer visibility */
  toggleVisibility: (layerId: string) => void;
  /** Reorder layers (move layer to new index) */
  reorderLayer: (layerId: string, newIndex: number) => void;
  /** Add a layer group */
  addGroup: (group: LayerGroup) => void;
  /** Remove a layer group */
  removeGroup: (groupId: string) => void;
  /** Toggle group expansion */
  toggleGroupExpanded: (groupId: string) => void;
  /** Select a layer */
  selectLayer: (layerId: string | null) => void;
  /** Clear all layers */
  clearLayers: () => void;
}

/**
 * Hook for managing map layers.
 *
 * Provides functionality to add, remove, update, and reorder layers on the map.
 * Supports both GeoJSON (vector) and raster layers.
 *
 * @example
 * ```tsx
 * function LayerExample() {
 *   const { addGeoJSONLayer, setOpacity, toggleVisibility } = useLayers();
 *
 *   const handleAddLayer = () => {
 *     addGeoJSONLayer({
 *       id: 'fire-perimeter',
 *       name: 'Fire Perimeter',
 *       data: perimeterGeoJSON,
 *       fillColor: '#ff6b35',
 *       opacity: 0.7,
 *       visible: true,
 *       zIndex: 1,
 *     });
 *   };
 * }
 * ```
 */
export function useLayers(): UseLayersReturn {
  const { map, isLoaded } = useMap();
  const [state, setState] = useState<LayerState>({
    layers: [],
    groups: [],
    selectedLayerId: null,
  });

  // Sync layer changes with map
  useEffect(() => {
    if (!map || !isLoaded) return;

    // Apply current state to map
    state.layers.forEach((layer) => {
      const mapLayer = map.getLayer(layer.id);
      if (mapLayer) {
        // Update visibility
        map.setLayoutProperty(
          layer.id,
          'visibility',
          layer.visible ? 'visible' : 'none'
        );

        // Update opacity based on layer type
        if (layer.type === 'geojson') {
          const fillLayerId = `${layer.id}-fill`;
          const lineLayerId = `${layer.id}-line`;
          if (map.getLayer(fillLayerId)) {
            map.setPaintProperty(fillLayerId, 'fill-opacity', layer.opacity * (layer.fillOpacity ?? 1));
          }
          if (map.getLayer(lineLayerId)) {
            map.setPaintProperty(lineLayerId, 'line-opacity', layer.opacity);
          }
        } else if (layer.type === 'raster') {
          map.setPaintProperty(layer.id, 'raster-opacity', layer.opacity);
        }
      }
    });
  }, [map, isLoaded, state.layers]);

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

      // Add fill layer for polygons
      if (!map.getLayer(`${config.id}-fill`)) {
        map.addLayer({
          id: `${config.id}-fill`,
          type: 'fill',
          source: config.id,
          paint: {
            'fill-color': config.fillColor || '#3388ff',
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
            'line-color': config.strokeColor || '#3388ff',
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

      setState((prev) => ({
        ...prev,
        layers: [...prev.layers, layerConfig],
      }));
    },
    [map, isLoaded]
  );

  const addRasterLayer = useCallback(
    (config: Omit<RasterLayerConfig, 'type'>): Promise<void> => {
      if (!map || !isLoaded) return Promise.resolve();

      const layerConfig: RasterLayerConfig = {
        ...config,
        type: 'raster',
      };

      // Add source
      if (!map.getSource(config.id)) {
        map.addSource(config.id, {
          type: 'raster',
          tiles: Array.isArray(config.url) ? config.url : [config.url],
          tileSize: config.tileSize || 256,
          ...(config.bounds ? { bounds: config.bounds } : {}),
        });
      }

      // Add raster layer
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

      // Return a Promise that resolves when tiles are loaded
      // Capture map reference for use in callbacks (we've already checked it's non-null)
      const mapRef = map;
      return new Promise<void>((resolve) => {
        const sourceId = config.id;
        const TIMEOUT_MS = 60000; // 60 second timeout

        // Check if source is already loaded
        if (mapRef.isSourceLoaded(sourceId)) {
          resolve();
          return;
        }

        // Set up timeout
        const timeoutId = setTimeout(() => {
          mapRef.off('sourcedata', onSourceData);
          console.warn(`[useLayers] Raster source ${sourceId} load timed out after ${TIMEOUT_MS}ms`);
          resolve(); // Resolve anyway so UI doesn't hang
        }, TIMEOUT_MS);

        // Listen for source data events
        function onSourceData(e: mapboxgl.MapSourceDataEvent) {
          if (e.sourceId === sourceId && e.isSourceLoaded) {
            clearTimeout(timeoutId);
            mapRef.off('sourcedata', onSourceData);
            resolve();
          }
        }

        mapRef.on('sourcedata', onSourceData);
      });
    },
    [map, isLoaded]
  );

  const removeLayer = useCallback(
    (layerId: string) => {
      if (!map) return;

      // Remove all sub-layers
      [`${layerId}-fill`, `${layerId}-line`, `${layerId}-point`, layerId].forEach((id) => {
        if (map.getLayer(id)) {
          map.removeLayer(id);
        }
      });

      // Remove source
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

  const toggleVisibility = useCallback(
    (layerId: string) => {
      setState((prev) => ({
        ...prev,
        layers: prev.layers.map((l) =>
          l.id === layerId ? { ...l, visible: !l.visible } : l
        ),
      }));
    },
    []
  );

  const reorderLayer = useCallback(
    (layerId: string, newIndex: number) => {
      setState((prev) => {
        const layers = [...prev.layers];
        const currentIndex = layers.findIndex((l) => l.id === layerId);
        if (currentIndex === -1) return prev;

        const [layer] = layers.splice(currentIndex, 1);
        layers.splice(newIndex, 0, layer);

        // Update zIndex values
        const updated = layers.map((l, i) => ({ ...l, zIndex: i }));

        return { ...prev, layers: updated };
      });
    },
    []
  );

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

  return {
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
  };
}
