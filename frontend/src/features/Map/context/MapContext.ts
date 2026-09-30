/**
 * Map context objects and the hooks that read them.
 *
 * Deliberately kept at this path, and deliberately holding the hooks rather
 * than only the context objects. Consumers import `useMap` from
 * '../context/MapContext', and several test files mock that exact module
 * specifier. Moving the hooks elsewhere would leave those vi.mock calls
 * pointing at a module nobody imports any more — they would stop intercepting
 * silently, and the tests would run against the real map without failing.
 *
 * The provider component lives in MapProvider.tsx so that file exports nothing
 * but a component, which is what Vite's fast refresh needs.
 */

import { createContext, useContext } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { MapContextValue } from '../types';

export const MapContext = createContext<MapContextValue | null>(null);

/**
 * Extended context value with setters for internal use
 */
export interface MapContextInternal extends MapContextValue {
  setMap: (map: MapLibreMap | null) => void;
  setIsLoaded: (loaded: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: Error | null) => void;
}

export const MapContextInternal = createContext<MapContextInternal | null>(null);

/**
 * Hook to access the map context.
 *
 * @returns Map context with map instance and loading state
 * @throws Error if used outside of MapProvider
 *
 * @example
 * ```tsx
 * function MyMapComponent() {
 *   const { map, isLoaded } = useMap();
 *
 *   useEffect(() => {
 *     if (map && isLoaded) {
 *       map.flyTo({ center: [-122.4, 37.8] });
 *     }
 *   }, [map, isLoaded]);
 * }
 * ```
 */
export function useMap(): MapContextValue {
  const context = useContext(MapContext);
  if (!context) {
    throw new Error('useMap must be used within a MapProvider');
  }
  return context;
}

/**
 * Optional version of useMap that returns null if no provider.
 *
 * Use this when the component may be rendered outside of a MapProvider,
 * such as when embedded in a host application that provides its own map.
 */
export function useMapOptional(): MapContextValue | null {
  return useContext(MapContext);
}

/**
 * Internal hook for MapContainer to set map state.
 * Not part of the feature's public surface — only for internal use.
 */
export function useMapInternal(): MapContextInternal {
  const context = useContext(MapContextInternal);
  if (!context) {
    throw new Error('useMapInternal must be used within a MapProvider');
  }
  return context;
}
