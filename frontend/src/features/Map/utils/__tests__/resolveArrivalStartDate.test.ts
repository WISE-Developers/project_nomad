/**
 * #482 — the seam that stops `App.tsx` substituting today's date.
 *
 * WHY THIS FILE EXISTS, and it is the honest reason. After I had removed the
 * substitution and had the whole frontend suite green, I mutated the line back
 * to `String(output.metadata?.startDate ?? new Date().toISOString())` and ran
 * every frontend test: **794 passed.** Nothing caught it. The one line the
 * board named as the merge blocker for #482 had no coverage at all, and I would
 * have merged believing it protected.
 *
 * The line was untestable where it sat — inside a long `useCallback` in
 * `App.tsx` that needs a map instance and a layer context. So the decision it
 * encodes is extracted here as a pure function, and `App.tsx` calls it. Now the
 * mutation fails.
 *
 * THE RULE: a start date exists only if one was RECORDED. Absent, null, blank,
 * or any non-string shape means unknown, and unknown stays unknown — the
 * arrival legend then labels bins by relative day (Franco's ruling, option (a),
 * 2026-10-30). It is never today's date, which is what the old fallback
 * produced: a 2023 reconstruction labelled 2026, in the field an analyst reads
 * to know which fire season they are looking at.
 */
import { describe, it, expect } from 'vitest';
import { resolveArrivalStartDate } from '../resolveArrivalStartDate';

describe('resolveArrivalStartDate', () => {
  it('returns a recorded ISO string unchanged', () => {
    expect(resolveArrivalStartDate('2023-06-19T12:00:00.000Z')).toBe(
      '2023-06-19T12:00:00.000Z',
    );
  });

  describe('unknown stays unknown — never today', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['empty string', ''],
      ['whitespace', '   '],
    ])('%s -> undefined', (_label, input) => {
      expect(resolveArrivalStartDate(input)).toBeUndefined();
    });

    it('never returns the current date for a missing value', () => {
      // The discriminating assertion. The old code produced
      // new Date().toISOString() here, so this is the exact regression.
      const thisYear = String(new Date().getUTCFullYear());

      const result = resolveArrivalStartDate(undefined);

      expect(result).toBeUndefined();
      expect(result ?? '').not.toContain(thisYear);
    });
  });

  describe('a non-string shape is not a date', () => {
    it.each([
      ['a number', 1687176000000],
      ['a boolean', true],
      ['an object', { start: '2023-06-19' }],
      ['an array', ['2023-06-19']],
    ])('%s -> undefined', (_label, input) => {
      // `String(x)` on any of these produces a value that LOOKS like data and
      // parses to an Invalid Date downstream. Rejecting them here means the
      // legend falls back to relative labels rather than rendering NaN.
      expect(resolveArrivalStartDate(input)).toBeUndefined();
    });
  });

  it('does not validate the date itself — that is the parser’s job', () => {
    // Deliberately NOT a date validator. Its one job is "was something
    // recorded". A malformed recorded value is a different defect and must not
    // be silently converted into "unknown", which would hide it.
    expect(resolveArrivalStartDate('not-a-date')).toBe('not-a-date');
  });

  it('trims a padded but real value', () => {
    expect(resolveArrivalStartDate('  2023-06-19T12:00:00.000Z  ')).toBe(
      '2023-06-19T12:00:00.000Z',
    );
  });
});
