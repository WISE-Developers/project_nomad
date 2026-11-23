import { ReactNode, useState, useCallback, useEffect, useRef } from 'react';
import type { TerraDraw } from 'terra-draw';
import type { GeoJSONStoreFeatures } from 'terra-draw';
// terra-draw and its maplibre adapter are loaded on demand, not at import —
// #567. They are part of the map stack, and an embedded consumer that never
// opens a Nomad map must not pay for them. Both remain REQUIRED peer
// dependencies: anyone who DOES open the map genuinely needs them.
import { useMap } from './MapContext';
import { DrawContext, type DrawContextValue } from './DrawContext';
import type { DrawingMode, DrawnFeature, DrawingState } from '../types/geometry';

/**
 * Convert a TerraDraw store feature to our DrawnFeature type.
 * Both are GeoJSON Features with Point/LineString/Polygon geometry —
 * the only difference is the properties type constraint.
 */
function toDrawnFeature(feature: GeoJSONStoreFeatures): DrawnFeature {
  return feature as DrawnFeature;
}

function toDrawnFeatures(features: GeoJSONStoreFeatures[]): DrawnFeature[] {
  return features as DrawnFeature[];
}



/**
 * Props for DrawProvider
 */
interface DrawProviderProps {
  children: ReactNode;
}

// Mode name mapping
const MODE_MAP: Record<DrawingMode, string> = {
  point: 'point',
  line: 'linestring',
  polygon: 'polygon',
  none: 'select',
};

/**
 * Provides drawing functionality to child components using TerraDraw.
 *
 * Uses terra-draw with the MapLibre GL adapter for cross-platform compatibility.
 */
export function DrawProvider({ children }: DrawProviderProps) {
  const { map, isLoaded } = useMap();
  const [isReady, setIsReady] = useState(false);
  const [state, setState] = useState<DrawingState>({
    mode: 'none',
    selectedIds: [],
    features: [],
  });

  // TerraDraw instance ref
  const terraDrawRef = useRef<TerraDraw | null>(null);

  // Ref to avoid stale closure in event handlers
  const featuresRef = useRef<DrawnFeature[]>(state.features);
  useEffect(() => {
    featuresRef.current = state.features;
  }, [state.features]);

  // Subscriber refs
  const createSubscribers = useRef<Set<(features: DrawnFeature[]) => void>>(new Set());
  const updateSubscribers = useRef<Set<(features: DrawnFeature[]) => void>>(new Set());
  const deleteSubscribers = useRef<Set<(features: DrawnFeature[]) => void>>(new Set());

  // Initialize TerraDraw when map is loaded
  useEffect(() => {
    if (!map || !isLoaded) return;

    // Guards the window between unmount and the dynamic imports resolving (#567):
    // without it the cleanup runs first, terraDrawRef is still null, and we then
    // `start()` a TerraDraw nothing will ever `stop()`.
    let cancelled = false;
    let started: TerraDraw | null = null;

    Promise.all([
      import('terra-draw'),
      import('terra-draw-maplibre-gl-adapter'),
    ]).then(([
      { TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawSelectMode },
      { TerraDrawMapLibreGLAdapter },
    ]) => {
      if (cancelled) return;

      const adapter = new TerraDrawMapLibreGLAdapter({
        map,
      });

      let idCounter = 0;
      const draw = new TerraDraw({
        adapter,
        modes: [
          new TerraDrawPointMode(),
          new TerraDrawLineStringMode(),
          new TerraDrawPolygonMode(),
          new TerraDrawSelectMode(),
        ],
        idStrategy: {
          isValidId: (id: string | number) => id !== undefined && id !== null,
          getId: () => `td-${Date.now()}-${++idCounter}`,
        },
      });

      // Set up event listeners
      draw.on('finish', (id) => {
        const feature = draw.getSnapshotFeature(id);
        if (feature) {
          const drawnFeature = toDrawnFeature(feature);
          setState((prev) => ({
            ...prev,
            features: [...prev.features, drawnFeature],
          }));
          createSubscribers.current.forEach((cb) => cb([drawnFeature]));
        }
      });

      draw.on('change', (ids, type) => {
        if (type === 'delete') {
          const deletedFeatures = featuresRef.current.filter(f => ids.includes(String(f.id)));
          if (deletedFeatures.length > 0) {
            setState((prev) => ({
              ...prev,
              features: prev.features.filter(f => !ids.includes(String(f.id))),
              selectedIds: prev.selectedIds.filter(id => !ids.includes(String(id))),
            }));
            deleteSubscribers.current.forEach((cb) => cb(deletedFeatures));
          }
        } else if (type === 'update') {
          const updatedFeatures: DrawnFeature[] = [];
          ids.forEach(id => {
            const feature = draw.getSnapshotFeature(id);
            if (feature) {
              updatedFeatures.push(toDrawnFeature(feature));
            }
          });
          if (updatedFeatures.length > 0) {
            setState((prev) => ({
              ...prev,
              features: prev.features.map(f =>
                ids.includes(String(f.id))
                  ? updatedFeatures.find(uf => String(uf.id) === String(f.id)) ?? f
                  : f
              ),
            }));
            updateSubscribers.current.forEach((cb) => cb(updatedFeatures));
          }
        }
      });

      draw.on('select', (id) => {
        setState((prev) => {
          const idStr = String(id);
          if (prev.selectedIds.includes(idStr)) return prev;
          return { ...prev, selectedIds: [...prev.selectedIds, idStr] };
        });
      });

      draw.on('deselect', (id) => {
        setState((prev) => ({
          ...prev,
          selectedIds: prev.selectedIds.filter(sid => sid !== String(id)),
        }));
      });

      // Start TerraDraw.
      //
      // `started` is assigned BEFORE `start()`, not after. The adapter registers
      // DOM listeners before it adds its sources, and MapLibre can throw
      // "Style is not done loading" from inside `start()` -- e.g. a basemap
      // switch landing while these imports were still in flight. Assigning
      // afterwards meant a throw left a half-started TerraDraw that the cleanup
      // could not see and would never `stop()`, leaking the adapter's listeners.
      // The pre-#567 code closed over `draw` directly in its cleanup and did not
      // have this hole; deferring the import is what opened it.
      started = draw;
      terraDrawRef.current = draw;
      draw.start();
      setIsReady(true);
    }).catch((err: unknown) => {
      if (cancelled) return;
      // A missing required peer, surfaced rather than swallowed: drawing silently
      // never becoming available is the kind of failure that gets diagnosed as a
      // UI bug for days.
      console.error('[DrawContext] failed to load the drawing stack:', err);
    });

    return () => {
      cancelled = true;
      if (started) {
        // May be half-started if `start()` threw; `stop()` is the only way to
        // release the adapter's listeners either way.
        try {
          started.stop();
        } catch (err) {
          console.error('[DrawContext] TerraDraw stop() failed during cleanup:', err);
        }
      }
      terraDrawRef.current = null;
      setIsReady(false);
    };
  }, [map, isLoaded]);

  const setMode = useCallback((mode: DrawingMode) => {
    setState((prev) => ({ ...prev, mode }));
    if (terraDrawRef.current) {
      terraDrawRef.current.setMode(MODE_MAP[mode]);
    }
  }, []);

  const getFeatures = useCallback((): DrawnFeature[] => {
    if (!terraDrawRef.current) return [];
    return toDrawnFeatures(terraDrawRef.current.getSnapshot());
  }, []);

  const deleteSelected = useCallback(() => {
    if (!terraDrawRef.current || state.selectedIds.length === 0) return;

    const deletedFeatures = state.features.filter(f => state.selectedIds.includes(String(f.id)));
    terraDrawRef.current.removeFeatures(state.selectedIds.map(id => String(id)));
    setState((prev) => ({
      ...prev,
      features: prev.features.filter(f => !prev.selectedIds.includes(String(f.id))),
      selectedIds: [],
    }));
    deleteSubscribers.current.forEach((cb) => cb(deletedFeatures));
  }, [state.selectedIds, state.features]);

  const deleteAll = useCallback(() => {
    if (!terraDrawRef.current) return;

    const deletedFeatures = [...state.features];
    terraDrawRef.current.clear();
    setState((prev) => ({
      ...prev,
      features: [],
      selectedIds: [],
    }));
    deleteSubscribers.current.forEach((cb) => cb(deletedFeatures));
  }, [state.features]);

  const addFeatures = useCallback((features: DrawnFeature[]) => {
    if (!terraDrawRef.current) return;

    // TerraDraw requires every feature to have an id and a valid mode property
    const featuresWithIds = features.map(f => {
      const geomType = f.geometry.type;
      const mode = geomType === 'Point' ? 'point'
        : geomType === 'LineString' ? 'linestring'
        : 'polygon';
      return {
        ...f,
        id: f.id ?? `td-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        properties: {
          ...(f.properties ?? {}),
          mode: String((f.properties as Record<string, unknown>)?.mode ?? mode),
        },
      };
    });

    try {
      const validations = terraDrawRef.current.addFeatures(featuresWithIds as GeoJSONStoreFeatures[]);
      const failures = validations.filter(v => !v.valid);
      if (failures.length > 0) {
        console.error('[DrawContext] TerraDraw rejected features:', failures);
      }
    } catch (err) {
      console.error('[DrawContext] TerraDraw addFeatures failed:', err);
    }

    // Always update state and notify — even if TerraDraw rejected the features,
    // the wizard and other consumers need to know about them
    setState((prev) => ({
      ...prev,
      features: [...prev.features, ...featuresWithIds],
    }));
    createSubscribers.current.forEach((cb) => cb(featuresWithIds));
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
