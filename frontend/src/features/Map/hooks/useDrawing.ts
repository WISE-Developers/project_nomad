import { useEffect, useRef, useCallback, useState } from 'react';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { useMap } from '../context/MapContext';
import type { DrawingMode, DrawnFeature, DrawingState, DrawingStyles } from '../types/geometry';

/**
 * Hook options
 */
interface UseDrawingOptions {
  /** Initial drawing mode */
  initialMode?: DrawingMode;
  /** Custom drawing styles */
  styles?: DrawingStyles;
  /** Callback when features are created */
  onCreate?: (features: DrawnFeature[]) => void;
  /** Callback when features are updated */
  onUpdate?: (features: DrawnFeature[]) => void;
  /** Callback when features are deleted */
  onDelete?: (features: DrawnFeature[]) => void;
  /** Callback when selection changes */
  onSelectionChange?: (features: DrawnFeature[]) => void;
}

/**
 * Hook return value
 */
interface UseDrawingReturn {
  /** Current drawing state */
  state: DrawingState;
  /** Set drawing mode */
  setMode: (mode: DrawingMode) => void;
  /** Get all drawn features */
  getFeatures: () => DrawnFeature[];
  /** Delete selected features */
  deleteSelected: () => void;
  /** Delete all features */
  deleteAll: () => void;
  /** Add features programmatically */
  addFeatures: (features: DrawnFeature[]) => void;
  /** Whether drawing is ready */
  isReady: boolean;
}

/**
 * Map drawing mode to MapboxDraw mode
 */
function toDrawMode(mode: DrawingMode): string {
  switch (mode) {
    case 'point':
      return 'draw_point';
    case 'line':
      return 'draw_line_string';
    case 'polygon':
      return 'draw_polygon';
    default:
      return 'simple_select';
  }
}

/**
 * Hook for managing map drawing operations.
 *
 * Provides point, line, and polygon drawing capabilities using Mapbox Draw.
 * Handles mode switching, feature creation/deletion, and selection.
 *
 * @example
 * ```tsx
 * function DrawingComponent() {
 *   const { state, setMode, deleteSelected } = useDrawing({
 *     onCreate: (features) => console.log('Created:', features),
 *   });
 *
 *   return (
 *     <div>
 *       <button onClick={() => setMode('point')}>Point</button>
 *       <button onClick={() => setMode('polygon')}>Polygon</button>
 *       <button onClick={deleteSelected}>Delete</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useDrawing(options: UseDrawingOptions = {}): UseDrawingReturn {
  const { map, isLoaded } = useMap();
  const drawRef = useRef<MapboxDraw | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [state, setState] = useState<DrawingState>({
    mode: options.initialMode || 'none',
    selectedIds: [],
    features: [],
  });

  // Initialize MapboxDraw
  useEffect(() => {
    if (!map || !isLoaded) return;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      defaultMode: 'simple_select',
    });

    map.addControl(draw as unknown as mapboxgl.IControl);
    drawRef.current = draw;
    setIsReady(true);

    // Set initial mode
    if (options.initialMode && options.initialMode !== 'none') {
      draw.changeMode(toDrawMode(options.initialMode));
    }

    return () => {
      if (map && drawRef.current) {
        map.removeControl(drawRef.current as unknown as mapboxgl.IControl);
        drawRef.current = null;
        setIsReady(false);
      }
    };
  }, [map, isLoaded]);

  // Set up event handlers
  useEffect(() => {
    if (!map || !isLoaded || !drawRef.current) return;

    const handleCreate = (e: { features: DrawnFeature[] }) => {
      setState((prev) => ({
        ...prev,
        features: [...prev.features, ...e.features],
      }));
      options.onCreate?.(e.features);
    };

    const handleUpdate = (e: { features: DrawnFeature[] }) => {
      setState((prev) => ({
        ...prev,
        features: prev.features.map((f) => {
          const updated = e.features.find((u) => u.id === f.id);
          return updated || f;
        }),
      }));
      options.onUpdate?.(e.features);
    };

    const handleDelete = (e: { features: DrawnFeature[] }) => {
      const deletedIds = new Set(e.features.map((f) => f.id));
      setState((prev) => ({
        ...prev,
        features: prev.features.filter((f) => !deletedIds.has(f.id)),
        selectedIds: prev.selectedIds.filter((id) => !deletedIds.has(id)),
      }));
      options.onDelete?.(e.features);
    };

    const handleSelectionChange = (e: { features: DrawnFeature[] }) => {
      setState((prev) => ({
        ...prev,
        selectedIds: e.features.map((f) => String(f.id)),
      }));
      options.onSelectionChange?.(e.features);
    };

    map.on('draw.create', handleCreate);
    map.on('draw.update', handleUpdate);
    map.on('draw.delete', handleDelete);
    map.on('draw.selectionchange', handleSelectionChange);

    return () => {
      map.off('draw.create', handleCreate);
      map.off('draw.update', handleUpdate);
      map.off('draw.delete', handleDelete);
      map.off('draw.selectionchange', handleSelectionChange);
    };
  }, [map, isLoaded, options.onCreate, options.onUpdate, options.onDelete, options.onSelectionChange]);

  const setMode = useCallback((mode: DrawingMode) => {
    if (!drawRef.current) return;
    drawRef.current.changeMode(toDrawMode(mode));
    setState((prev) => ({ ...prev, mode }));
  }, []);

  const getFeatures = useCallback((): DrawnFeature[] => {
    if (!drawRef.current) return [];
    return drawRef.current.getAll().features as DrawnFeature[];
  }, []);

  const deleteSelected = useCallback(() => {
    if (!drawRef.current) return;
    const selected = drawRef.current.getSelectedIds();
    if (selected.length > 0) {
      drawRef.current.delete(selected);
    }
  }, []);

  const deleteAll = useCallback(() => {
    if (!drawRef.current) return;
    drawRef.current.deleteAll();
    setState((prev) => ({ ...prev, features: [], selectedIds: [] }));
  }, []);

  const addFeatures = useCallback((features: DrawnFeature[]) => {
    if (!drawRef.current) return;
    features.forEach((f) => drawRef.current!.add(f));
    setState((prev) => ({ ...prev, features: [...prev.features, ...features] }));
  }, []);

  return {
    state,
    setMode,
    getFeatures,
    deleteSelected,
    deleteAll,
    addFeatures,
    isReady,
  };
}
