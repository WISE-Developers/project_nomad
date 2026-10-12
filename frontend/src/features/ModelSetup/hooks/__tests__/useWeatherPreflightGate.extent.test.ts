/**
 * #432 — the extent warning must reach the operator BEFORE they hit run.
 *
 * Franco, 2026-10-12: "yes before they hit run!"
 *
 * THE DEFECT THIS FILE EXISTS FOR, found by reading the hook rather than
 * assuming it: `guardedComplete` RETURNS EARLY for spotwx and raw_weather —
 * `if (!needsPreflight(data.weather))` — and again when no CSV file is
 * attached. On those paths preflight is never called at all. So wiring the
 * extent answer into the preflight response was NOT sufficient: an operator
 * drawing a 300 km fire with spotwx weather would have received the warning
 * through a code path that never runs.
 *
 * The weather check could skip the round trip because its question only
 * concerns the file. The extent question concerns the GEOMETRY, which every
 * run has regardless of where its weather comes from.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWeatherPreflightGate } from '../useWeatherPreflightGate.js';
import type { ModelSetupData } from '../../types/index.js';

const M_PER_DEGREE_LAT = 111_320;

function squareFeature(spanM: number, lat = 55) {
  const dLat = spanM / M_PER_DEGREE_LAT;
  const dLon = spanM / (M_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return {
    id: 'f1',
    properties: { mode: 'polygon' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-114, lat],
          [-114 + dLon, lat],
          [-114 + dLon, lat + dLat],
          [-114, lat + dLat],
          [-114, lat],
        ],
      ],
    },
  };
}

/** spotwx: the path that skipped preflight entirely. */
function spotwxData(spanM: number): ModelSetupData {
  return {
    geometry: { features: [squareFeature(spanM)] },
    temporal: {
      startDate: '2026-08-04',
      startTime: '12:00',
      durationHours: 72,
      timezone: 'America/Edmonton',
      isForecast: false,
    },
    model: {},
    weather: { source: 'spotwx' },
  } as unknown as ModelSetupData;
}

const CLEAN_WEATHER = { dailyOnlyCffdrs: false, candidate: null, rhythm: null };

function extentOf(overrides: Record<string, unknown>) {
  return {
    measured: true,
    withinLimit: true,
    nearLimit: false,
    widthM: 0,
    heightM: 0,
    ...overrides,
  };
}

describe('useWeatherPreflightGate — extent (#432)', () => {
  let onComplete: ReturnType<typeof vi.fn>;
  let preflight: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onComplete = vi.fn();
    preflight = vi.fn().mockResolvedValue({ ...CLEAN_WEATHER, extent: extentOf({}) });
  });

  function setup() {
    return renderHook(() => useWeatherPreflightGate(onComplete, { preflight }));
  }

  describe('the control: the check is reached at all on a spotwx run', () => {
    it('calls preflight even though spotwx needs no weather inspection', async () => {
      // Without this, every assertion below is about a request nobody sends.
      const { result } = setup();
      await act(async () => {
        await result.current.guardedComplete(spotwxData(50_000));
      });

      expect(preflight).toHaveBeenCalled();
    });

    it('sends the drawn geometry, not just the weather fields', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.guardedComplete(spotwxData(50_000));
      });

      const body = preflight.mock.calls[0][0];
      expect(body.ignitions).toBeDefined();
      expect(body.ignitions.length).toBe(1);
    });
  });

  describe('an ordinary fire', () => {
    it('submits straight through with nothing to say', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.guardedComplete(spotwxData(50_000));
      });

      expect(onComplete).toHaveBeenCalled();
      expect(result.current.extentWarning).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('a fire in the warning band', () => {
    beforeEach(() => {
      preflight.mockResolvedValue({
        ...CLEAN_WEATHER,
        extent: extentOf({ nearLimit: true, warning: 'This fire spans 300 km east-west…' }),
      });
    });

    it('holds the submission and surfaces the warning', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.guardedComplete(spotwxData(300_000));
      });

      // Held, not submitted — the point of "before they hit run" is that the
      // operator still has the choice.
      expect(onComplete).not.toHaveBeenCalled();
      expect(result.current.extentWarning).not.toBeNull();
      expect(result.current.extentWarning?.message).toMatch(/300 km/);
    });

    it('submits when the operator acknowledges it', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.guardedComplete(spotwxData(300_000));
      });
      await act(async () => {
        await result.current.extentWarning?.proceed();
      });

      expect(onComplete).toHaveBeenCalled();
      expect(result.current.extentWarning).toBeNull();
    });

    it('abandons without submitting when the operator goes back', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.guardedComplete(spotwxData(300_000));
      });
      await act(async () => {
        result.current.extentWarning?.cancel();
      });

      expect(onComplete).not.toHaveBeenCalled();
      expect(result.current.extentWarning).toBeNull();
    });

    it('is advisory, not an error — those render differently', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.guardedComplete(spotwxData(300_000));
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('a fire over the hard limit', () => {
    beforeEach(() => {
      preflight.mockResolvedValue({
        ...CLEAN_WEATHER,
        extent: extentOf({
          withinLimit: false,
          nearLimit: true,
          reason: 'This fire spans 1,300 km east-west, which is too large…',
        }),
      });
    });

    it('blocks, and never offers a way to proceed', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.guardedComplete(spotwxData(1_300_000));
      });

      expect(onComplete).not.toHaveBeenCalled();
      expect(result.current.error).toMatch(/1,300 km/);
      // The advisory must not appear for a refusal — an acknowledgeable
      // warning here would let the operator press on into a cropped run.
      expect(result.current.extentWarning).toBeNull();
    });
  });

  describe('when the check could not be made', () => {
    it('does not treat an unmeasured extent as a cleared one', async () => {
      // measured:false means nothing was measured. A hook that read that as
      // "fine" would show a cleared check for a check that never ran — the
      // absence reported in the same words as the nothing.
      preflight.mockResolvedValue({
        ...CLEAN_WEATHER,
        extent: extentOf({ measured: false }),
      });

      const { result } = setup();
      await act(async () => {
        await result.current.guardedComplete(spotwxData(50_000));
      });

      // It still submits — an unmeasurable extent must not block a legal run —
      // but it must not claim to have warned about anything.
      expect(onComplete).toHaveBeenCalled();
      expect(result.current.extentWarning).toBeNull();
    });
  });
});
