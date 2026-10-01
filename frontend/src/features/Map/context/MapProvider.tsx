import { ReactNode, useState, useCallback } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { MapContext, MapContextInternal } from './MapContext';

/**
 * Props for MapProvider component
 */
interface MapProviderProps {
  children: ReactNode;
}

/**
 * Provides map context to child components.
 *
 * This provider manages the MapLibre GL map instance and loading state,
 * making them available to any child component via the useMap hook.
 */
export function MapProvider({ children }: MapProviderProps) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const value: MapContextInternal = {
    map,
    isLoaded,
    isLoading,
    error,
    setMap: useCallback((m: MapLibreMap | null) => setMap(m), []),
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
