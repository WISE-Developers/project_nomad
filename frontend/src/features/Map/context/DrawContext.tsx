import { createContext, useContext, ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { useMap } from './MapContext';
import type { DrawingMode, DrawnFeature, DrawingState } from '../types/geometry';

/**
 * Draw context value
 */
interface DrawContextValue {
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
  /** Register a callback for create events */
  onCreateSubscribe: (callback: (features: DrawnFeature[]) => void) => () => void;
  /** Register a callback for update events */
  onUpdateSubscribe: (callback: (features: DrawnFeature[]) => void) => () => void;
  /** Register a callback for delete events */
  onDeleteSubscribe: (callback: (features: DrawnFeature[]) => void) => () => void;
}

const DrawContext = createContext<DrawContextValue | null>(null);

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
 * Props for DrawProvider
 */
interface DrawProviderProps {
  children: ReactNode;
}

/**
 * Provides a shared MapboxDraw instance to all child components.
 *
 * This solves the conflict between DrawingToolbar and MeasurementTool
 * by ensuring only one Draw control exists on the map.
 */
export function DrawProvider({ children }: DrawProviderProps) {
  const { map, isLoaded } = useMap();
  const drawRef = useRef<MapboxDraw | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [state, setState] = useState<DrawingState>({
    mode: 'none',
    selectedIds: [],
    features: [],
  });

  // Subscriber refs
  const createSubscribers = useRef<Set<(features: DrawnFeature[]) => void>>(new Set());
  const updateSubscribers = useRef<Set<(features: DrawnFeature[]) => void>>(new Set());
  const deleteSubscribers = useRef<Set<(features: DrawnFeature[]) => void>>(new Set());

  // Initialize MapboxDraw once
  useEffect(() => {
    if (!map || !isLoaded || drawRef.current) return;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      defaultMode: 'simple_select',
      styles: [
        // Polygon fill - transparent yellow
        {
          id: 'gl-draw-polygon-fill',
          type: 'fill',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: {
            'fill-color': '#FFD700',
            'fill-opacity': 0.2,
          },
        },
        // Polygon outline - solid yellow
        {
          id: 'gl-draw-polygon-stroke',
          type: 'line',
          filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
          paint: {
            'line-color': '#FFD700',
            'line-width': 4,
          },
        },
        // Line - solid yellow
        {
          id: 'gl-draw-line',
          type: 'line',
          filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
          paint: {
            'line-color': '#FFD700',
            'line-width': 4,
          },
        },
        // Point (outer circle) - solid yellow
        {
          id: 'gl-draw-point-outer',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
          paint: {
            'circle-radius': 10,
            'circle-color': '#FFD700',
          },
        },
        // Point (inner circle for selection)
        {
          id: 'gl-draw-point-inner',
          type: 'circle',
          filter: ['all', ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
          paint: {
            'circle-radius': 5,
            'circle-color': '#FFFFFF',
          },
        },
        // Vertex points (for editing)
        {
          id: 'gl-draw-vertex',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'vertex'], ['!=', 'mode', 'static']],
          paint: {
            'circle-radius': 6,
            'circle-color': '#FFFFFF',
            'circle-stroke-color': '#FFD700',
            'circle-stroke-width': 2,
          },
        },
        // Midpoint vertices
        {
          id: 'gl-draw-midpoint',
          type: 'circle',
          filter: ['all', ['==', 'meta', 'midpoint']],
          paint: {
            'circle-radius': 4,
            'circle-color': '#FFD700',
          },
        },
      ],
    });

    map.addControl(draw as unknown as mapboxgl.IControl);
    drawRef.current = draw;
    setIsReady(true);

    // Event handlers
    const handleCreate = (e: { features: DrawnFeature[] }) => {
      setState((prev) => ({
        ...prev,
        features: [...prev.features, ...e.features],
      }));
      createSubscribers.current.forEach((cb) => cb(e.features));
    };

    const handleUpdate = (e: { features: DrawnFeature[] }) => {
      setState((prev) => ({
        ...prev,
        features: prev.features.map((f) => {
          const updated = e.features.find((u) => u.id === f.id);
          return updated || f;
        }),
      }));
      updateSubscribers.current.forEach((cb) => cb(e.features));
    };

    const handleDelete = (e: { features: DrawnFeature[] }) => {
      const deletedIds = new Set(e.features.map((f) => f.id));
      setState((prev) => ({
        ...prev,
        features: prev.features.filter((f) => !deletedIds.has(f.id)),
        selectedIds: prev.selectedIds.filter((id) => !deletedIds.has(id)),
      }));
      deleteSubscribers.current.forEach((cb) => cb(e.features));
    };

    const handleSelectionChange = (e: { features: DrawnFeature[] }) => {
      setState((prev) => ({
        ...prev,
        selectedIds: e.features.map((f) => String(f.id)),
      }));
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

      if (drawRef.current) {
        map.removeControl(drawRef.current as unknown as mapboxgl.IControl);
        drawRef.current = null;
        setIsReady(false);
      }
    };
  }, [map, isLoaded]);

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
    // Notify create subscribers so useGeometrySync picks up the change
    createSubscribers.current.forEach((cb) => cb(features));
  }, []);

  const onCreateSubscribe = useCallback((callback: (features: DrawnFeature[]) => void) => {
    createSubscribers.current.add(callback);
    return () => { createSubscribers.current.delete(callback); };
  }, []);

  const onUpdateSubscribe = useCallback((callback: (features: DrawnFeature[]) => void) => {
    updateSubscribers.current.add(callback);
    return () => { updateSubscribers.current.delete(callback); };
  }, []);

  const onDeleteSubscribe = useCallback((callback: (features: DrawnFeature[]) => void) => {
    deleteSubscribers.current.add(callback);
    return () => { deleteSubscribers.current.delete(callback); };
  }, []);

  const value: DrawContextValue = {
    state,
    setMode,
    getFeatures,
    deleteSelected,
    deleteAll,
    addFeatures,
    isReady,
    onCreateSubscribe,
    onUpdateSubscribe,
    onDeleteSubscribe,
  };

  return (
    <DrawContext.Provider value={value}>
      {children}
    </DrawContext.Provider>
  );
}

/**
 * Hook to access the shared draw context.
 *
 * @throws Error if used outside of DrawProvider
 */
export function useDraw(): DrawContextValue {
  const context = useContext(DrawContext);
  if (!context) {
    throw new Error('useDraw must be used within a DrawProvider');
  }
  return context;
}

/**
 * Optional version of useDraw that returns null if no provider.
 *
 * Use this when the component may be rendered outside of a DrawProvider,
 * such as when embedded in a host application that provides its own map.
 */
export function useDrawOptional(): DrawContextValue | null {
  return useContext(DrawContext);
}
