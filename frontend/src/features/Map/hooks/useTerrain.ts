import { useCallback, useState, useEffect } from 'react';
import { useMap } from '../context/MapContext';

/**
 * Terrain configuration
 */
export interface TerrainConfig {
  /** Whether 3D terrain is enabled */
  enabled: boolean;
  /** Terrain exaggeration factor (1.0 - 3.0) */
  exaggeration: number;
}

/**
 * Local storage key for terrain settings
 */
const STORAGE_KEY = 'nomad-terrain-config';

/**
 * Default terrain configuration
 */
const DEFAULT_CONFIG: TerrainConfig = {
  enabled: false,
  exaggeration: 1.5,
};

/**
 * Hook return value
 */
interface UseTerrainReturn {
  /** Current terrain configuration */
  config: TerrainConfig;
  /** Toggle terrain on/off */
  toggle: () => void;
  /** Set terrain exaggeration */
  setExaggeration: (value: number) => void;
  /** Enable terrain */
  enable: () => void;
  /** Disable terrain */
  disable: () => void;
  /** Whether the map supports terrain */
  isSupported: boolean;
}

/**
 * Hook for managing 3D terrain visualization.
 *
 * Provides controls for enabling/disabling terrain and adjusting exaggeration.
 * Settings are persisted in localStorage.
 *
 * @example
 * ```tsx
 * function TerrainExample() {
 *   const { config, toggle, setExaggeration } = useTerrain();
 *
 *   return (
 *     <div>
 *       <button onClick={toggle}>
 *         {config.enabled ? '2D' : '3D'}
 *       </button>
 *       <input
 *         type="range"
 *         min="1"
 *         max="3"
 *         step="0.1"
 *         value={config.exaggeration}
 *         onChange={(e) => setExaggeration(Number(e.target.value))}
 *       />
 *     </div>
 *   );
 * }
 * ```
 */
export function useTerrain(): UseTerrainReturn {
  const { map, isLoaded } = useMap();
  const [config, setConfig] = useState<TerrainConfig>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : DEFAULT_CONFIG;
  });
  const [isSupported, setIsSupported] = useState(true);

  // Apply terrain settings when map loads or config changes
  useEffect(() => {
    if (!map || !isLoaded) return;

    const applyTerrain = () => {
      try {
        // Add DEM source if not exists
        if (!map.getSource('mapbox-dem')) {
          map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14,
          });
        }

        if (config.enabled) {
          map.setTerrain({
            source: 'mapbox-dem',
            exaggeration: config.exaggeration,
          });
          // Set pitch for better 3D viewing
          if (map.getPitch() < 30) {
            map.easeTo({ pitch: 45, duration: 500 });
          }
        } else {
          map.setTerrain(null);
          // Reset pitch when disabling
          if (map.getPitch() > 0) {
            map.easeTo({ pitch: 0, duration: 500 });
          }
        }

        setIsSupported(true);
      } catch (error) {
        console.warn('Terrain not supported:', error);
        setIsSupported(false);
      }
    };

    // Apply on style load (in case style changes)
    map.on('style.load', applyTerrain);

    // Apply immediately if style already loaded
    if (map.isStyleLoaded()) {
      applyTerrain();
    }

    return () => {
      map.off('style.load', applyTerrain);
    };
  }, [map, isLoaded, config]);

  // Persist config changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const toggle = useCallback(() => {
    setConfig((prev) => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  const setExaggeration = useCallback((value: number) => {
    const clamped = Math.max(1, Math.min(3, value));
    setConfig((prev) => ({ ...prev, exaggeration: clamped }));
  }, []);

  const enable = useCallback(() => {
    setConfig((prev) => ({ ...prev, enabled: true }));
  }, []);

  const disable = useCallback(() => {
    setConfig((prev) => ({ ...prev, enabled: false }));
  }, []);

  return {
    config,
    toggle,
    setExaggeration,
    enable,
    disable,
    isSupported,
  };
}
