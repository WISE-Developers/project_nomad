/**
 * #432, second half — the WARNING band below the hard reject.
 *
 * The hard reject is at 409.6 km, where FireSTARR silently crops. But a fire
 * that is merely large still gets a plausible result, and the operator has no
 * way to know they are approaching a cliff with no guard rail on the far side.
 *
 * THE THRESHOLD IS 180 km, APPROVED BY FRANCO 2026-10-12, and it is derived
 * rather than chosen:
 *
 *   - The largest realised footprint span MEASURED across our probability
 *     rasters is 115 km (n = 12, one run dominating the set).
 *   - Franco's 2x climate padding: a future fire season may plausibly double
 *     the spans we have on record.
 *   - 115 x 2 = 230 km, which sits comfortably under the 409.6 km cliff. The
 *     threshold is set at 180 km so that a drawn input of that size warns
 *     BEFORE growth carries the realised footprint toward the limit.
 *
 * WHAT IS MEASURED VS WHAT IS INFERRED, stated because a later reader setting a
 * new threshold must not mistake one for the other:
 *   - MEASURED: 115 km, from the rasters themselves.
 *   - JUDGEMENT: the 2x padding, and 180 as the warn point.
 *   - n = 12 is thin and Franco accepted it knowing that.
 *
 * And the reason it was measured at all: my first estimate derived the span
 * from a circular area over the recorded hectares, and it was 41% BELOW the
 * extent the rasters actually showed. Fires are not discs. Measuring beat
 * inferring, and the inference was confidently wrong in the unsafe direction.
 */
import { describe, it, expect } from 'vitest';
import { SpatialGeometry, GeometryType } from '../../../domain/entities/index.js';
import {
  checkSimulationExtent,
  MAX_EXTENT_M,
  WARN_EXTENT_M,
} from '../simulationExtent.js';

const M_PER_DEGREE_LAT = 111_320;

/** A square polygon of a given north-south span, at a Canadian latitude. */
function squareOfSpan(spanM: number, lat = 55): SpatialGeometry {
  const dLat = spanM / M_PER_DEGREE_LAT;
  const dLon = spanM / (M_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return new SpatialGeometry({
    type: GeometryType.Polygon,
    coordinates: [
      [
        [-114, lat],
        [-114 + dLon, lat],
        [-114 + dLon, lat + dLat],
        [-114, lat + dLat],
        [-114, lat],
      ],
    ],
  });
}

describe('simulation extent warning band (#432)', () => {
  describe('the threshold itself', () => {
    it('is 180 km', () => {
      expect(WARN_EXTENT_M).toBe(180_000);
    });

    it('sits below the hard limit, which is what makes it a warning', () => {
      // If these ever cross, the warning becomes unreachable and this module
      // would report a clean run right up to the cliff.
      expect(WARN_EXTENT_M).toBeLessThan(MAX_EXTENT_M);
    });
  });

  describe('a fire comfortably inside the band', () => {
    it('warns about nothing', () => {
      const check = checkSimulationExtent(squareOfSpan(50_000));
      expect(check.withinLimit).toBe(true);
      expect(check.nearLimit).toBe(false);
      expect(check.warning).toBeUndefined();
    });

    it('is the control: a 50 km fire must stay silent, or the warning is noise', () => {
      // A threshold that fires on ordinary fires trains operators to ignore it,
      // which is worse than no warning at all.
      expect(checkSimulationExtent(squareOfSpan(50_000)).warning).toBeUndefined();
      expect(checkSimulationExtent(squareOfSpan(115_000)).warning).toBeUndefined();
    });
  });

  describe('a fire in the warning band', () => {
    it('warns, and still runs', () => {
      const check = checkSimulationExtent(squareOfSpan(200_000));
      // The run is NOT refused — that is the whole distinction from the reject.
      expect(check.withinLimit).toBe(true);
      expect(check.nearLimit).toBe(true);
      expect(check.warning).toBeDefined();
    });

    it('names the measurement, the limit, and what happens at the limit', () => {
      const warning = checkSimulationExtent(squareOfSpan(200_000)).warning ?? '';
      expect(warning).toMatch(/200 km/); // what was measured
      expect(warning).toMatch(/409\.6 km/); // where the cliff is
      expect(warning).toMatch(/crop/i); // what the engine does there
    });

    it('does not tell the operator the run will fail, because it will not', () => {
      const warning = checkSimulationExtent(squareOfSpan(200_000)).warning ?? '';
      expect(warning).not.toMatch(/cannot|refus|too large|error/i);
    });
  });

  describe('the boundary', () => {
    it('is silent exactly at the threshold and warns just above it', () => {
      // Asserting both sides. A one-sided boundary test passes against an
      // implementation that always warns.
      expect(checkSimulationExtent(squareOfSpan(WARN_EXTENT_M - 1_000)).nearLimit).toBe(false);
      expect(checkSimulationExtent(squareOfSpan(WARN_EXTENT_M + 1_000)).nearLimit).toBe(true);
    });
  });

  describe('a fire over the hard limit', () => {
    it('is rejected, and the reject is not downgraded to a warning', () => {
      const check = checkSimulationExtent(squareOfSpan(500_000));
      expect(check.withinLimit).toBe(false);
      expect(check.reason).toBeDefined();
      // nearLimit is true as a matter of fact, but withinLimit:false is what
      // the caller acts on. The warning must never stand in for the refusal.
      expect(check.reason).toMatch(/409\.6 km/);
    });
  });

  describe('no geometry', () => {
    it('warns about nothing, because nothing was measured', () => {
      // "Nothing to measure" must not render as "measured and fine" — the
      // absence reported in the same words as the nothing.
      const check = checkSimulationExtent(undefined);
      expect(check.withinLimit).toBe(true);
      expect(check.nearLimit).toBe(false);
      expect(check.warning).toBeUndefined();
    });
  });
});
