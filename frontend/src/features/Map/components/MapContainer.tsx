import { useEffect, useRef, ReactNode } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapInternal } from '../context/MapContext';
import { DrawProvider } from '../context/DrawContext';
import { MapOptions, DEFAULT_MAP_OPTIONS } from '../types';

/**
 * Props for MapContainer component
 */
interface MapContainerProps {
  /** Map initialization options */
  options?: MapOptions;
  /** Child components (controls, overlays, etc.) */
  children?: ReactNode;
  /** CSS class for the map container */
  className?: string;
  /** Inline styles for the map container */
  style?: React.CSSProperties;
}

/**
 * MapContainer component that initializes and manages a Mapbox GL map.
 *
 * This component must be used within a MapProvider. It handles:
 * - Map initialization with provided options
 * - Proper cleanup on unmount
 * - Loading state management
 * - Error handling
 *
 * @example
 * ```tsx
 * <MapProvider>
 *   <MapContainer options={{ center: [-122.4, 37.8], zoom: 12 }}>
 *     <DrawingToolbar />
 *     <LayerPanel />
 *   </MapContainer>
 * </MapProvider>
 * ```
 */
export function MapContainer({
  options = {},
  children,
  className = '',
  style,
}: MapContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const { setMap, setIsLoaded, setIsLoading, setError } = useMapInternal();

  useEffect(() => {
    if (!containerRef.current) return;

    // Get access token from environment
    const accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!accessToken) {
      setError(new Error('VITE_MAPBOX_TOKEN environment variable is not set'));
      setIsLoading(false);
      return;
    }

    mapboxgl.accessToken = accessToken;

    // Merge options with defaults
    const mergedOptions = { ...DEFAULT_MAP_OPTIONS, ...options };

    try {
      setIsLoading(true);
      setError(null);

      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: mergedOptions.style,
        center: mergedOptions.center,
        zoom: mergedOptions.zoom,
        pitch: mergedOptions.pitch,
        bearing: mergedOptions.bearing,
        attributionControl: true,
        preserveDrawingBuffer: true, // Needed for export/screenshots
      });

      mapRef.current = map;

      map.on('load', () => {
        setMap(map);
        setIsLoaded(true);
        setIsLoading(false);

        // Add terrain if enabled
        if (mergedOptions.terrain) {
          map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14,
          });
          map.setTerrain({
            source: 'mapbox-dem',
            exaggeration: mergedOptions.terrainExaggeration,
          });
        }

        // Add navigation controls
        map.addControl(new mapboxgl.NavigationControl(), 'top-right');
        map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      });

      map.on('error', (e) => {
        console.error('Map error:', e.error);
        setError(e.error);
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsLoading(false);
    }

    // Cleanup on unmount
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        setMap(null);
        setIsLoaded(false);
      }
    };
  }, []); // Only run once on mount

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'relative',
    ...style,
  };

  return (
    <div className={`map-container ${className}`} style={containerStyle}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <DrawProvider>
        {children}
      </DrawProvider>
    </div>
  );
}
