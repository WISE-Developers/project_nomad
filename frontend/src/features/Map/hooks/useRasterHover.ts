/**
 * useRasterHover — raster burn-probability hover tooltip
 *
 * Reads pixel colour under the mouse via WebGL readPixels and maps it back
 * to a probability percentage using the FireSTARR colour ramp.  A MapLibre
 * popup is shown/hidden as the cursor moves over the map canvas.
 *
 * @module features/Map/hooks/useRasterHover
 */

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { PROBABILITY_LEGEND } from '../symbology/palettes.js';

// =============================================================================
// FireSTARR Colour Ramp
// =============================================================================

/** Parse a "#rrggbb" hex string into an [r, g, b] triple. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Reverse-mapping anchors: rendered pixel colour -> probability band label.
 * Sourced from the shared SLD palette (#283) so hover, the legend, and the
 * backend contours all trace to the one vendored FireSTARR SLD ramp — blue low
 * (#00B1F2 -> "0-10%") to red high (#E6151F -> ">90%"). No hand-copied ramp.
 */
const RAMP: ReadonlyArray<{ rgb: [number, number, number]; label: string }> =
  PROBABILITY_LEGEND.map(({ label, color }) => ({ rgb: hexToRgb(color), label }));

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
 * At 100% opacity (required for hover) raster colours are unblended, so a
 * rendered band pixel sits ~0 units from its SLD anchor. A moderate threshold
 * matches near-exact band colours while rejecting basemap/background colours
 * (e.g. pure blue 0,0,255 is ~177 units from the cyan-blue low anchor).
 */
const MAX_RAMP_DISTANCE = 70;

export function colorToPercentage(
  r: number,
  g: number,
  b: number,
  a?: number,
): string | null {
  // Fully transparent — no data
  if (a === 0) return null;

  // Reject very dark pixels (basemap shadows, labels)
  if (r < 20 && g < 20 && b < 20) return null;
  // Reject very bright pixels (white areas, clouds)
  if (r > 240 && g > 240 && b > 240) return null;

  // Find the nearest band — no interpolation, discrete classes only
  let minDist = Infinity;
  let minIdx = -1;
  for (let i = 0; i < RAMP.length; i++) {
    const [ar, ag, ab] = RAMP[i].rgb;
    const dist = rgbDistance(r, g, b, ar, ag, ab);
    if (dist < minDist) {
      minDist = dist;
      minIdx = i;
    }
  }

  if (minDist > MAX_RAMP_DISTANCE || minIdx < 0) return null;

  return RAMP[minIdx].label;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Props for useRasterHover
 */
interface UseRasterHoverProps {
  /** MapLibre map instance */
  map: maplibregl.Map | null;
  /** Whether any raster layer has hover enabled (visible + 100% opacity) */
  hasVisibleRasterLayer: boolean;
}

/**
 * Hook that attaches a mousemove listener to the MapLibre canvas, reads the
 * pixel colour under the cursor using WebGL readPixels, and shows a MapLibre
 * popup displaying the burn probability percentage.
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
  const popupRef = useRef<maplibregl.Popup | null>(null);

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
    const gl = canvas.getContext('webgl2');

    // Initialise popup (lazy)
    if (!popupRef.current) {
      popupRef.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'raster-probability-popup',
      });
    }

    const popup = popupRef.current;

    function handleMouseMove(e: maplibregl.MapMouseEvent) {
      if (!gl) return;

      const pixel = new Uint8Array(4);
      const x = e.point.x;
      // WebGL y-axis is flipped relative to screen coordinates
      const y = canvas.height - e.point.y;

      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

      const [r, g, b, a] = pixel;
      const band = colorToPercentage(r, g, b, a);

      if (band !== null) {
        popup
          .setLngLat(e.lngLat)
          .setHTML(`<div style="color:#333;font-size:13px;padding:2px 4px"><strong>Burn Probability:</strong> ${band}</div>`)
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
