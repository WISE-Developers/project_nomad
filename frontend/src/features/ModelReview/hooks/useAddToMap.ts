/**
 * useAddToMap Hook
 *
 * Adds model output layers to the main map using the Map feature's useLayers hook.
 */

import { useCallback, useRef } from 'react';
import { useLayers } from '../../Map';
import type { OutputItem, OutputType } from '../types';

/**
 * Color configuration for output types
 */
const OUTPUT_TYPE_COLORS: Record<OutputType, { fill: string; stroke: string }> = {
  burn_probability: { fill: '#ff6b35', stroke: '#d94e1f' },
  probability: { fill: '#ff6b35', stroke: '#d94e1f' }, // Backend actual value
  fire_intensity: { fill: '#ff0000', stroke: '#cc0000' },
  intensity: { fill: '#ff0000', stroke: '#cc0000' }, // Backend actual value
  arrival_time: { fill: '#9c27b0', stroke: '#7b1fa2' },
  fire_perimeter: { fill: '#ff9800', stroke: '#f57c00' },
  perimeter: { fill: '#ff9800', stroke: '#f57c00' }, // Backend actual value
  ember_density: { fill: '#ffeb3b', stroke: '#fbc02d' },
  weather_grid: { fill: '#2196f3', stroke: '#1976d2' },
  fuel_grid: { fill: '#4caf50', stroke: '#388e3c' },
};

/**
 * Get default colors for output type
 */
function getOutputColors(type: OutputType): { fill: string; stroke: string } {
  return OUTPUT_TYPE_COLORS[type] || { fill: '#808080', stroke: '#666666' };
}

/**
 * Hook return value
 */
interface UseAddToMapReturn {
  /** Add an output to the main map */
  addOutput: (output: OutputItem, geoJson: GeoJSON.GeoJSON) => string;
  /** Remove an output layer from the map */
  removeOutput: (layerId: string) => void;
  /** Check if an output is already on the map */
  isOnMap: (outputId: string) => boolean;
  /** Get all output layer IDs currently on the map */
  outputLayerIds: string[];
}

/**
 * Hook for adding model outputs to the main map.
 *
 * Uses the Map feature's useLayers hook to manage output visualization
 * on the main application map.
 *
 * @example
 * ```tsx
 * function ModelReviewContainer() {
 *   const { addOutput, removeOutput, isOnMap } = useAddToMap();
 *
 *   const handleAddToMap = (output, geoJson) => {
 *     if (!isOnMap(output.id)) {
 *       addOutput(output, geoJson);
 *     }
 *   };
 * }
 * ```
 */
export function useAddToMap(): UseAddToMapReturn {
  const { addGeoJSONLayer, removeLayer } = useLayers();
  const outputLayersRef = useRef<Set<string>>(new Set());

  /**
   * Generate a unique layer ID for an output
   */
  const getLayerId = useCallback((outputId: string) => {
    return `output-${outputId}`;
  }, []);

  /**
   * Add an output to the map
   */
  const addOutput = useCallback(
    (output: OutputItem, geoJson: GeoJSON.GeoJSON): string => {
      const layerId = getLayerId(output.id);
      const colors = getOutputColors(output.type);

      // Check if this uses data-driven styling (color per feature)
      const hasFeatureColors =
        geoJson.type === 'FeatureCollection' &&
        geoJson.features.some((f) => f.properties?.color);

      // Add the layer with appropriate styling
      addGeoJSONLayer({
        id: layerId,
        name: output.name,
        data: geoJson as GeoJSON.FeatureCollection,
        // Use feature color if available, otherwise use output type color
        fillColor: hasFeatureColors ? ['get', 'color'] as unknown as string : colors.fill,
        strokeColor: hasFeatureColors ? ['get', 'color'] as unknown as string : colors.stroke,
        strokeWidth: 2,
        opacity: 0.8,
        fillOpacity: 0.5,
        visible: true,
        zIndex: 100 + outputLayersRef.current.size,
      });

      outputLayersRef.current.add(layerId);
      return layerId;
    },
    [addGeoJSONLayer, getLayerId]
  );

  /**
   * Remove an output layer from the map
   */
  const removeOutput = useCallback(
    (layerId: string) => {
      removeLayer(layerId);
      outputLayersRef.current.delete(layerId);
    },
    [removeLayer]
  );

  /**
   * Check if an output is already on the map
   */
  const isOnMap = useCallback(
    (outputId: string): boolean => {
      const layerId = getLayerId(outputId);
      return outputLayersRef.current.has(layerId);
    },
    [getLayerId]
  );

  /**
   * Get all output layer IDs
   */
  const outputLayerIds = Array.from(outputLayersRef.current);

  return {
    addOutput,
    removeOutput,
    isOnMap,
    outputLayerIds,
  };
}
