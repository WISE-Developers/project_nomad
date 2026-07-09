/**
 * #286 — The map must NOT auto-frame (flyTo/fitBounds) while a draw tool is
 * armed. Finishing each polygon otherwise yanks the camera, and clicks meant
 * for the next polygon land during the animation and get consumed as map
 * gestures ("zoom on click instead of adding points"). Auto-framing is only
 * appropriate for non-draw input (Upload Ignition / Enter Coordinates), i.e.
 * when the draw mode is 'none'.
 */
import { describe, it, expect } from 'vitest';
import { shouldAutoFrame } from '../shouldAutoFrame.js';

describe('shouldAutoFrame (refs #286)', () => {
  it('suppresses auto-frame while an active draw tool is armed', () => {
    expect(shouldAutoFrame('point')).toBe(false);
    expect(shouldAutoFrame('line')).toBe(false);
    expect(shouldAutoFrame('polygon')).toBe(false);
  });

  it('allows auto-frame when not drawing (upload / coordinates)', () => {
    expect(shouldAutoFrame('none')).toBe(true);
    expect(shouldAutoFrame(null)).toBe(true);
    expect(shouldAutoFrame(undefined)).toBe(true);
  });
});
