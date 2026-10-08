/**
 * A completed run should name who produced the fuel it used (#431).
 *
 * The setup screen shows "2022 (start-of-2023 fuel state) [Jordan Evens]"; the
 * results panel showed the same line without the producer, because
 * recordedToResolved returned no `dataset` at all and the notice renders the
 * producer from `resolved.dataset?.producer`. Franco spotted the difference by
 * comparing the two screens.
 *
 * Records written before #431 carry no producer — ten already exist, including
 * the real 2026-10-08 run — so the absence must stay clean rather than
 * producing an empty bracket pair.
 */

import { describe, it, expect } from 'vitest';
import { recordedToResolved } from '../fuelVintage';
import type { RecordedFuelVintage } from '../fuelVintage';

function record(over: Partial<RecordedFuelVintage> = {}): RecordedFuelVintage {
  return {
    requestedYear: 2023,
    vintage: '2023',
    datasetYear: 2023,
    fuelVintage: 2022,
    matchedRequestedYear: true,
    usedFallback: false,
    ...over,
  };
}

describe('recordedToResolved — producer (#431)', () => {
  it('carries the recorded producer through to the notice', () => {
    const resolved = recordedToResolved(record({ producer: 'Jordan Evens' }));

    expect(resolved.dataset?.producer).toBe('Jordan Evens');
  });

  it('keeps the years it already derived', () => {
    const resolved = recordedToResolved(record({ producer: 'Jordan Evens' }));

    expect(resolved.datasetYear).toBe(2023);
    expect(resolved.fuelVintage).toBe(2022);
  });

  it('leaves dataset undefined when no producer was recorded', () => {
    // Not an empty object: the notice tests `resolved.dataset?.producer`, and a
    // dataset present but blank would render " []" — worse than silence.
    const resolved = recordedToResolved(record());

    expect(resolved.dataset?.producer).toBeUndefined();
  });
});
