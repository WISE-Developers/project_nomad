/**
 * describeFuelVintage — what to tell the user about the fuel their run uses (#319)
 *
 * Fuel datasets are installed per vintage year and lookup silently falls back
 * {year}/ -> default/. The user could not see which fuel was used, so a 2019
 * fire could be modelled on 2026 fuel with no indication.
 *
 * Every outcome here is NON-BLOCKING. Modelling an old fire on newer fuel is a
 * legitimate thing to do deliberately — the goal is that it is never done
 * accidentally.
 *
 * Convention: vintage = RUN year (start-of-year fuel state). A run in year N
 * uses dataset N. Not off-by-one.
 */

import { describe, it, expect } from 'vitest';
import { describeFuelVintage } from '../fuelVintage';
import type { ResolvedFuelDataset } from '../fuelVintage';

const resolved = (over: Partial<ResolvedFuelDataset>): ResolvedFuelDataset => ({
  requestedYear: 2026,
  vintage: 2026,
  matchedRequestedYear: true,
  usedFallback: false,
  ...over,
});

describe('describeFuelVintage', () => {
  it('reports an exact vintage match with no warning', () => {
    const result = describeFuelVintage(resolved({ requestedYear: 2023, vintage: 2023 }));

    expect(result.vintageLabel).toBe('2023');
    expect(result.severity).toBe('none');
    expect(result.warning).toBeUndefined();
  });

  it('warns when the requested year fell back to the default dataset', () => {
    const result = describeFuelVintage(
      resolved({ requestedYear: 2023, vintage: 2026, matchedRequestedYear: false, usedFallback: true })
    );

    expect(result.severity).toBe('warning');
    expect(result.warning).toContain('2023');
    expect(result.blocking).toBe(false);
  });

  it('names both years so the direction of the mismatch is visible', () => {
    const result = describeFuelVintage(
      resolved({ requestedYear: 2019, vintage: 2026, matchedRequestedYear: false, usedFallback: true })
    );

    expect(result.warning).toContain('2019');
    expect(result.warning).toContain('2026');
  });

  it('warns when nothing resolved at all', () => {
    const result = describeFuelVintage(
      resolved({ requestedYear: 2023, vintage: undefined, matchedRequestedYear: false, usedFallback: false })
    );

    expect(result.severity).toBe('warning');
    expect(result.vintageLabel).toBe('unknown');
    expect(result.blocking).toBe(false);
  });

  it('warns in the newer-fire-on-older-fuel direction too', () => {
    const result = describeFuelVintage(
      resolved({ requestedYear: 2026, vintage: 2023, matchedRequestedYear: false, usedFallback: true })
    );

    expect(result.severity).toBe('warning');
    expect(result.warning).toContain('2026');
    expect(result.warning).toContain('2023');
  });

  it('is never blocking, whatever the outcome', () => {
    const outcomes = [
      resolved({}),
      resolved({ matchedRequestedYear: false, usedFallback: true, vintage: 2020 }),
      resolved({ matchedRequestedYear: false, usedFallback: false, vintage: undefined }),
    ];

    for (const outcome of outcomes) {
      expect(describeFuelVintage(outcome).blocking).toBe(false);
    }
  });

  it('returns an unknown, non-warning description when resolution is unavailable', () => {
    // e.g. the API has not answered yet — absence of data is not a problem to
    // shout about, it is simply nothing to say.
    const result = describeFuelVintage(undefined);

    expect(result.vintageLabel).toBe('unknown');
    expect(result.severity).toBe('none');
    expect(result.warning).toBeUndefined();
  });
});
