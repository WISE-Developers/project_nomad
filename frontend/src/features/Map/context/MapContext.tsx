import { createContext, useContext, ReactNode, useState, useCallback } from 'react';
import type { Map as MapboxMap } from 'mapbox-gl';
import type { MapContextValue } from '../types';

const MapContext = createContext<MapContextValue | null>(null);

/**
 * Props for MapProvider component
 */
interface MapProviderProps {
  children: ReactNode;
}

/**
 * Extended context value with setters for internal use
 */
interface MapContextInternal extends MapContextValue {
  setMap: (map: MapboxMap | null) => void;
  setIsLoaded: (loaded: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setError: (error: Error | null) => void;
}

const MapContextInternal = createContext<MapContextInternal | null>(null);

/**
 * Provides map context to child components.
 *
 * This provider manages the Mapbox GL map instance and loading state,
 * making them available to any child component via the useMap hook.
 */
export function MapProvider({ children }: MapProviderProps) {
  const [map, setMap] = useState<MapboxMap | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const value: MapContextInternal = {
    map,
    isLoaded,
    isLoading,
    error,
    setMap: useCallback((m: MapboxMap | null) => setMap(m), []),
    setIsLoaded: useCallback((l: boolean) => setIsLoaded(l), []),
    setIsLoading: useCallback((l: boolean) => setIsLoading(l), []),
    setError: useCallback((e: Error | null) => setError(e), []),
  };

  return (
    <MapContextInternal.Provider value={value}>
      <MapContext.Provider value={{ map, isLoaded, isLoading, error }}>
        {children}
      </MapContext.Provider>
    </MapContextInternal.Provider>
  );
}

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
 * Not exported from the module - only for internal use.
 */
export function useMapInternal(): MapContextInternal {
  const context = useContext(MapContextInternal);
  if (!context) {
    throw new Error('useMapInternal must be used within a MapProvider');
  }
  return context;
}
