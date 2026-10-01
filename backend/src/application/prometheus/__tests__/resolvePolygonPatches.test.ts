/**
 * Deciding what to do with a polygon weather patch (refs #294).
 *
 * A weather patch bounded by a polygon changes conditions over part of the map.
 * A FireSTARR weather stream is ONE series for the whole run, so there is
 * nowhere to put a spatially-limited change. We cannot make it do what it
 * cannot do.
 *
 * So the operator gets the best available choice — apply it to the whole run,
 * or ignore it — and NEITHER reproduces the original. Applying globally changes
 * weather outside the polygon too; ignoring drops a modification the author
 * deliberately made.
 *
 * That matters because #294 exists so old incidents can be re-run and COMPARED.
 * A model that silently differs from its source undermines the comparison it
 * was imported for, so each choice is recorded as a divergence that travels
 * with the plan rather than disappearing once the blocker clears.
 *
 * Fuel patches are the same shape of problem with no choice at all: fuels come
 * from Nomad, so they are always skipped, and that is a divergence too.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { planFgmjImport } from '../planFgmjImport.js';
import { resolvePolygonPatches } from '../resolvePolygonPatches.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (n: string) => path.join(TEST_DATA, n);
const SAGE1 = 'prometheus_job_sage1_patches_multiignition.fgmj';
const POLY = 'Weather Poly Patch for Sage';

/** Row 13 is 13:00 on the 26th — the first hour inside the patch window. */
const INSIDE = 13;

describe('resolvePolygonPatches', () => {
  describe('apply as global', () => {
    it('applies the patch to the whole stream', () => {
      const [best] = planFgmjImport(fixture(SAGE1));
      // The polygon patch sets precipitation to 5; the raw stream is dry here,
      // which makes it the one variable the other applied patch cannot mask.
      expect(best.weather[INSIDE].precip).toBe(0);

      const resolved = resolvePolygonPatches(best, { [POLY]: 'global' });

      expect(resolved.weather[INSIDE].precip).toBeCloseTo(5, 6);
    });

    it('still respects the patch window', () => {
      const [best] = planFgmjImport(fixture(SAGE1));
      const resolved = resolvePolygonPatches(best, { [POLY]: 'global' });

      // Row 0 is 00:00 on the 26th, before the window opens.
      expect(resolved.weather[0].precip).toBe(best.weather[0].precip);
    });

    it('clears the blocker and records what it did', () => {
      const [best] = planFgmjImport(fixture(SAGE1));
      const resolved = resolvePolygonPatches(best, { [POLY]: 'global' });

      expect(resolved.blockers).not.toContain('polygonWeatherPatch');
      expect(resolved.appliedPatches).toContain(POLY);
    });
  });

  describe('ignore', () => {
    it('leaves the weather exactly as it was', () => {
      const [best] = planFgmjImport(fixture(SAGE1));
      const resolved = resolvePolygonPatches(best, { [POLY]: 'ignore' });

      expect(resolved.weather[INSIDE].precip).toBe(best.weather[INSIDE].precip);
      expect(resolved.weather[INSIDE].temp).toBeCloseTo(best.weather[INSIDE].temp, 9);
    });

    it('clears the blocker without applying the patch', () => {
      const [best] = planFgmjImport(fixture(SAGE1));
      const resolved = resolvePolygonPatches(best, { [POLY]: 'ignore' });

      expect(resolved.blockers).not.toContain('polygonWeatherPatch');
      expect(resolved.appliedPatches).not.toContain(POLY);
    });
  });

  describe('the divergence is recorded either way', () => {
    it('says the patch was applied beyond its polygon', () => {
      const [best] = planFgmjImport(fixture(SAGE1));
      const resolved = resolvePolygonPatches(best, { [POLY]: 'global' });

      const text = resolved.divergences.join(' ');
      expect(text).toMatch(/Weather Poly Patch for Sage/);
      expect(text).toMatch(/whole|global|entire/i);
    });

    it('says the patch was dropped', () => {
      const [best] = planFgmjImport(fixture(SAGE1));
      const resolved = resolvePolygonPatches(best, { [POLY]: 'ignore' });

      const text = resolved.divergences.join(' ');
      expect(text).toMatch(/Weather Poly Patch for Sage/);
      expect(text).toMatch(/not applied|ignored|dropped/i);
    });

    it('already records the skipped fuel patch before any decision', () => {
      const [best] = planFgmjImport(fixture(SAGE1));

      expect(best.divergences.join(' ')).toMatch(/all fuel to c2/);
    });

    it('KEEPS divergences the plan already carried', () => {
      // A decision about one patch must not drop what was recorded about
      // another. Losing an already-known difference is the exact failure this
      // whole mechanism exists to prevent, and it is invisible unless asserted.
      const [best] = planFgmjImport(fixture(SAGE1));
      expect(best.divergences.join(' ')).toMatch(/all fuel to c2/);

      for (const choice of ['global', 'ignore'] as const) {
        const resolved = resolvePolygonPatches(best, { [POLY]: choice });
        expect(resolved.divergences.join(' '), choice).toMatch(/all fuel to c2/);
        expect(resolved.divergences.length, choice).toBeGreaterThan(best.divergences.length);
      }
    });
  });

  describe('an undecided patch stays blocked', () => {
    it('does not default to either choice', () => {
      const plans = planFgmjImport(fixture(SAGE1));
      const threeDay = plans[2];
      expect(threeDay.polygonPatches).toContain(POLY);

      const resolved = resolvePolygonPatches(threeDay, {});

      expect(resolved.blockers).toContain('polygonWeatherPatch');
      expect(resolved.appliedPatches).not.toContain(POLY);
      expect(resolved.weather[INSIDE].precip).toBe(threeDay.weather[INSIDE].precip);
    });
  });

  describe('stop and alert', () => {
    it('refuses a decision about a patch this scenario does not have', () => {
      const [best] = planFgmjImport(fixture(SAGE1));

      expect(() => resolvePolygonPatches(best, { 'no-such-patch': 'global' })).toThrow(
        /no-such-patch/,
      );
    });

    it('refuses a choice it does not understand', () => {
      const [best] = planFgmjImport(fixture(SAGE1));

      expect(() =>
        resolvePolygonPatches(best, { [POLY]: 'maybe' as unknown as 'global' }),
      ).toThrow(/maybe/);
    });
  });
});
