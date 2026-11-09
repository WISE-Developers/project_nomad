/**
 * One resolver for both routes (#522).
 *
 * `POST /models/:id/execute` honours `modelMode` and falls back to the legacy
 * `outputMode` — that is #435's fix. `POST /models/run` declared `outputMode` in its
 * request type and never read it, so a client asking for a deterministic run there got
 * a probabilistic one with no warning: it completed, produced output, and produced the
 * wrong KIND of output. A deterministic request answered with probability rasters has
 * no arrival grids, so everything downstream that reconstructs a perimeter finds
 * nothing, far from the request that caused it.
 *
 * #435 fixed one route and not its sibling. This is the shared resolution, so the two
 * cannot drift again.
 */
import { describe, it, expect } from 'vitest';
import { resolveModelMode } from '../buildExecutionOptions.js';

describe('resolveModelMode', () => {
  it('honours modelMode when it is the only field given', () => {
    expect(resolveModelMode({ modelMode: 'deterministic' })).toBe('deterministic');
    expect(resolveModelMode({ modelMode: 'probabilistic' })).toBe('probabilistic');
  });

  it('honours the legacy outputMode when modelMode is absent', () => {
    // The defect: this returned undefined on /models/run and the caller defaulted to
    // probabilistic.
    expect(resolveModelMode({ outputMode: 'deterministic' })).toBe('deterministic');
  });

  it('lets modelMode win when both are present and disagree', () => {
    expect(resolveModelMode({ modelMode: 'probabilistic', outputMode: 'deterministic' }))
      .toBe('probabilistic');
    expect(resolveModelMode({ modelMode: 'deterministic', outputMode: 'probabilistic' }))
      .toBe('deterministic');
  });

  it('returns undefined when neither is given, leaving the default to the caller', () => {
    expect(resolveModelMode({})).toBeUndefined();
  });

  it('does not invent deterministic from a probabilistic legacy value', () => {
    // The positive half. A resolver that returned 'deterministic' whenever outputMode
    // was merely present would satisfy the second assertion above.
    expect(resolveModelMode({ outputMode: 'probabilistic' })).toBeUndefined();
  });

  it('passes a non-deterministic modelMode through untouched', () => {
    // 'long-term-risk' is rejected further up as not yet selectable; the resolver must
    // not quietly rewrite it, or the rejection would never fire.
    expect(resolveModelMode({ modelMode: 'long-term-risk' })).toBe('long-term-risk');
  });
});
