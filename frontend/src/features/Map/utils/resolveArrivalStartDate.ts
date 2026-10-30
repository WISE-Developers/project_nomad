/**
 * Was a model start instant RECORDED? (#482)
 *
 * `App.tsx` used to build the arrival layer's metadata with
 * `String(output.metadata?.startDate ?? new Date().toISOString())`, so a run
 * that recorded no start was labelled with TODAY — a 2023 reconstruction
 * rendering as the current year, in the field an analyst reads to know which
 * fire season and fuel vintage they are looking at.
 *
 * Extracted as its own function because that line sat inside a long
 * `useCallback` needing a map instance and a layer context, and was therefore
 * untestable in place: with the substitution removed and the whole frontend
 * suite green, putting it back still passed all 794 tests. An untested guard on
 * the one line that blocked this merge is not a guard.
 *
 * Unknown stays unknown. The arrival legend then labels bins by relative day
 * ("Day 1", "Day 2") — Franco's ruling, option (a), 2026-10-30 — rather than
 * showing a date nobody recorded.
 */

/**
 * The recorded start instant, or undefined when nothing recorded one.
 *
 * NOT a date validator. Its only question is whether a value was recorded, so a
 * malformed recorded value is passed through rather than being converted into
 * "unknown" — that would hide a different defect behind this one.
 */
export function resolveArrivalStartDate(raw: unknown): string | undefined {
  // Anything that is not a string is not a recorded date. `String(raw)` on a
  // number, object or array yields something that looks like data and becomes
  // an Invalid Date downstream, rendering as NaN in the legend.
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}
