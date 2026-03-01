/**
 * useRasterHover — raster burn-probability hover tooltip
 *
 * Reads pixel colour under the mouse via WebGL readPixels and maps it back
 * to a probability percentage using the FireSTARR colour ramp.  A Mapbox
 * popup is shown/hidden as the cursor moves over the map canvas.
 *
 * @module features/Map/hooks/useRasterHover
 */

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

// =============================================================================
// FireSTARR Colour Ramp
// =============================================================================

/**
 * Ordered anchor points of the FireSTARR burn-probability colour ramp.
 * Each entry is [percentage, r, g, b].
 * The array is sorted from highest to lowest probability.
 */
const RAMP: ReadonlyArray<readonly [number, number, number, number]> = [
  [90, 255, 0, 0],     // red
  [75, 255, 165, 0],   // orange
  [50, 255, 255, 0],   // yellow
  [25, 173, 255, 47],  // yellow-green
  [10, 0, 255, 0],     // green
] as const;

/** Euclidean distance between two RGB colours. */
function rgbDistance(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
): number {
  return Math.sqrt(
    (r1 - r2) ** 2 +
    (g1 - g2) ** 2 +
    (b1 - b2) ** 2,
  );
}

/**
 * Maximum colour distance (Euclidean RGB) considered to be "on the ramp".
 *
 * The largest gap between adjacent ramp anchors is ~179 units (yellow-green
 * to green), so a midpoint colour is up to ~90 units from its nearest anchor.
 * Setting the threshold to 130 keeps midpoint interpolation working while
 * firmly rejecting background colours (black ~255, white ~224, blue ~360).
 */
const MAX_RAMP_DISTANCE = 130;

/**
 * Map an RGB pixel from a FireSTARR raster tile to its burn-probability
 * percentage.
 *
 * The function linearly interpolates between the two nearest anchor points
 * on the colour ramp so intermediate hues resolve to intermediate percentages.
 * Colours that do not resemble any ramp colour (background, no-data, etc.)
 * return `null`.
 *
 * @param r - Red channel (0–255)
 * @param g - Green channel (0–255)
 * @param b - Blue channel (0–255)
 * @param a - Alpha channel (0–255). When 0 the pixel is transparent → null.
 * @returns Probability percentage (10–90) or null when the colour is not on
 *          the ramp.
 */
export function colorToPercentage(
  r: number,
  g: number,
  b: number,
  a?: number,
): number | null {
  // Fully transparent — no data
  if (a === 0) return null;

  // Find the two closest anchor points
  const distances = RAMP.map(([pct, ar, ag, ab]) => ({
    pct,
    dist: rgbDistance(r, g, b, ar, ag, ab),
  }));

  distances.sort((x, y) => x.dist - y.dist);
  const nearest = distances[0];
  const second = distances[1];

  // Reject colours that are too far from the ramp (background / no-data)
  if (nearest.dist > MAX_RAMP_DISTANCE) return null;

  // Exact match (or near-exact)
  if (nearest.dist === 0) return nearest.pct;

  // Linear interpolation weighted by inverse distance
  const totalDist = nearest.dist + second.dist;
  if (totalDist === 0) return nearest.pct;

  const weight = nearest.dist / totalDist;      // 0 = exactly on nearest
  const interpolated =
    nearest.pct * (1 - weight) + second.pct * weight;

  return Math.round(interpolated);
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Props for useRasterHover
 */
interface UseRasterHoverProps {
  /** Mapbox map instance */
  map: mapboxgl.Map | null;
  /** Whether any raster layer is currently visible */
  hasVisibleRasterLayer: boolean;
}

/**
 * Hook that attaches a mousemove listener to the Mapbox canvas, reads the
 * pixel colour under the cursor using WebGL readPixels, and shows a popup
 * displaying the burn probability percentage.
 *
 * The popup is removed when the cursor leaves the canvas or when no visible
 * raster layers are present.
 *
 * @example
 * ```tsx
 * useRasterHover({ map, hasVisibleRasterLayer: rasterLayers.some(l => l.visible) });
 * ```
 */
export function useRasterHover({
  map,
  hasVisibleRasterLayer,
}: UseRasterHoverProps): void {
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  useEffect(() => {
    if (!map || !hasVisibleRasterLayer) {
      // Clean up any lingering popup
      if (popupRef.current) {
        popupRef.current.remove();
        popupRef.current = null;
      }
      return;
    }

    const canvas = map.getCanvas();
    const gl = canvas.getContext('webgl') ?? canvas.getContext('webgl2');

    // Initialise popup (lazy)
    if (!popupRef.current) {
      popupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'raster-probability-popup',
      });
    }

    const popup = popupRef.current;

    function handleMouseMove(e: mapboxgl.MapMouseEvent) {
      if (!gl) return;

      const pixel = new Uint8Array(4);
      const x = e.point.x;
      // WebGL y-axis is flipped relative to screen coordinates
      const y = canvas.height - e.point.y;

      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

      const [r, g, b, a] = pixel;
      const pct = colorToPercentage(r, g, b, a);

      if (pct !== null) {
        popup
          .setLngLat(e.lngLat)
          .setHTML(`<strong>Burn Probability:</strong> ${pct}%`)
          .addTo(map!);
      } else {
        popup.remove();
      }
    }

    function handleMouseLeave() {
      popup.remove();
    }

    map.on('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      map.off('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      popup.remove();
    };
  }, [map, hasVisibleRasterLayer]);
}
