import { useEffect, useRef, ReactNode } from 'react';
import * as maplibregl from 'maplibre-gl';
import '../maplibreWorker';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMapInternal } from '../context/MapContext';
import { DrawProvider } from '../context/DrawContext';
import { MapOptions, DEFAULT_MAP_OPTIONS, BASEMAP_STYLES, BasemapStyle } from '../types';

/** Local storage key for persisting basemap selection (shared with BasemapSwitcher) */
const BASEMAP_STORAGE_KEY = 'nomad-basemap-style';

/** Local storage key for persisting map view position */
const VIEW_STORAGE_KEY = 'nomad-map-view';

/** Saved map view state */
interface SavedMapView {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

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
 * MapContainer component that initializes and manages a MapLibre GL map.
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
  const mapRef = useRef<maplibregl.Map | null>(null);
  const { setMap, setIsLoaded, setIsLoading, setError } = useMapInternal();

  useEffect(() => {
    if (!containerRef.current) return;

    // Merge options with defaults
    const mergedOptions = { ...DEFAULT_MAP_OPTIONS, ...options };

    // Get saved basemap style from localStorage or use default
    const savedStyle = localStorage.getItem(BASEMAP_STORAGE_KEY) as BasemapStyle | null;
    const initialStyle = savedStyle && BASEMAP_STYLES[savedStyle]
      ? BASEMAP_STYLES[savedStyle].url
      : mergedOptions.style;

    // Get saved map view position from localStorage
    let initialCenter = mergedOptions.center;
    let initialZoom = mergedOptions.zoom;
    let initialPitch = mergedOptions.pitch;
    let initialBearing = mergedOptions.bearing;

    const savedView = localStorage.getItem(VIEW_STORAGE_KEY);
    if (savedView) {
      try {
        const view: SavedMapView = JSON.parse(savedView);
        initialCenter = view.center;
        initialZoom = view.zoom;
        initialPitch = view.pitch;
        initialBearing = view.bearing;
      } catch {
        // Invalid saved view, use defaults
      }
    }

    try {
      setIsLoading(true);
      setError(null);

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: initialStyle,
        center: initialCenter,
        zoom: initialZoom,
        pitch: initialPitch,
        bearing: initialBearing,
        attributionControl: { compact: true },
        canvasContextAttributes: { preserveDrawingBuffer: true }, // Required for useRasterHover (gl.readPixels)
      });

      mapRef.current = map;

      map.on('load', () => {
        setMap(map);
        setIsLoaded(true);
        setIsLoading(false);

        // Add navigation controls
        map.addControl(new maplibregl.NavigationControl(), 'top-right');
        map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      });

      // Save map view position on move end
      map.on('moveend', () => {
        const center = map.getCenter();
        const view: SavedMapView = {
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        };
        localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
      });

      map.on('error', (e) => {
        console.error('Map error:', e.error);
        // maplibre 6 widened this to ErrorLike, which is not necessarily an
        // Error instance. Normalise rather than cast, so the message a user
        // eventually sees is never "[object Object]" (refs #372).
        const raw: unknown = e.error;
        setError(raw instanceof Error ? raw : new Error(String((raw as { message?: string })?.message ?? raw)));
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
