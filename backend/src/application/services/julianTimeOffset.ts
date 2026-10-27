/**
 * Hours from a model's start, computed from two Julian day-of-year numbers.
 *
 * This formula existed twice in ModelResultsService and only one copy was
 * right. The deterministic perimeter path used `(julianDay - startJulian) * 24`;
 * the stored-output path used `julianDay * 24`, which is anchored to the start
 * of the YEAR, so day one of a June run reported 4080 hours. That line was
 * replaced with a hard-coded null (TODO #236-followup) because the start day
 * was not in scope where the outputs were built — which is why the per-day
 * probability rasters, a genuine time series, carry no time coordinate.
 *
 * Extracted so there is one copy, and so the unknown cases are explicit:
 * an unknown start or an unknown day yields NULL, never zero. `modelStartDate`
 * deliberately returns undefined rather than today, and a confident wrong
 * offset is worse than an absent one.
 */

/** Days in a year, used only to unwrap a run that crosses 31 December. */
const DAYS_IN_YEAR = 365;

/**
 * Day of year, 1-indexed, in UTC — the same convention FireSTARR uses in its
 * output filenames (`probability_170_2023-06-19.tif` is 19 June).
 *
 * Computed in UTC deliberately: a local-time derivation shifts the day across
 * midnight for anyone east or west of the model's own zone, which would move a
 * raster into the wrong day of the series.
 */
export function dayOfYear(d: Date): number {
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - jan1) / 86_400_000) + 1;
}

export function timeOffsetHoursForJulianDay(
  julianDay: number | null | undefined,
  startJulian: number | null | undefined,
): number | null {
  if (julianDay === null || julianDay === undefined) return null;
  if (startJulian === null || startJulian === undefined) return null;
  if (!Number.isFinite(julianDay) || !Number.isFinite(startJulian)) return null;

  let elapsed = julianDay - startJulian;

  // A run that begins in late December and ends in January yields a negative
  // difference. A negative offset would order the series backwards, so unwrap
  // it rather than emit one.
  if (elapsed < 0) elapsed += DAYS_IN_YEAR;

  return elapsed * 24;
}

/**
 * The Julian day a series of per-day outputs is measured from.
 *
 * Prefers the model's recorded start date, which comes from `timeRange.start`
 * in output-config.json or model.json and carries an offset, so it parses
 * strictly. Falls back to the EARLIEST day present in the series.
 *
 * The fallback exists because the other candidate source does not work and
 * cannot be made to work without a decision nobody has taken: every real
 * FireSTARR `weather.csv` states its datetime as `2023-06-19 06:00:00` with no
 * zone, and this codebase deliberately refuses bare timestamps after #273
 * (TZ double-adjust hardening). The series' own first day needs no parsing and
 * no zone, which is why it is the fallback rather than a guessed UTC reading.
 */
export function resolveSeriesStartJulian(
  julianDays: readonly number[],
  modelStartDate: Date | undefined | null,
): number | null {
  if (modelStartDate) return dayOfYear(modelStartDate);
  const known = julianDays.filter(d => Number.isFinite(d));
  if (known.length === 0) return null;
  return Math.min(...known);
}
