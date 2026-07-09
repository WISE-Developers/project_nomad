import type { DrawingMode } from '../types/geometry';

/**
 * Whether the map may auto-frame (flyTo/fitBounds) to newly-changed geometry.
 *
 * While a draw tool is armed, auto-framing yanks the camera after each completed
 * feature and eats clicks meant for the next vertex/polygon — they land during
 * the animation and MapLibre treats them as map gestures ("zoom on click instead
 * of adding points", refs #286). So auto-framing is suppressed while drawing and
 * only allowed for non-draw input (Upload Ignition / Enter Coordinates), i.e.
 * when the draw mode is 'none' (or absent).
 */
export function shouldAutoFrame(mode: DrawingMode | null | undefined): boolean {
  return !mode || mode === 'none';
}
