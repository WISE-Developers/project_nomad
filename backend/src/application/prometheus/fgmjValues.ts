/**
 * Reading values out of a decoded .fgmj (refs #294).
 *
 * The schema wraps scalars in ways that differ field by field, so the same
 * logical value arrives in more than one shape:
 *
 *   name   plain string on a station, google.protobuf.StringValue — and so
 *          `{value: "..."}` — on a weather stream
 *   number `{value: {value: 5, hex: "0x1.4p+2"}}`, a Math.Double inside the
 *          variable message, so the number sits one or two levels down
 *   time   `{time: "2025-06-26T13:00:00-06:00", timezone: "MDT", ...}`
 *
 * Three modules need these, which is the point at which a third copy stops
 * being cheaper than one import. Handling only the unwrapped shape is not a
 * cosmetic bug: a resolver that read `name` as a string alone found no weather
 * streams at all, in any fixture.
 */

export type FgmjObject = Record<string, unknown>;

/** A `name`, whether the schema wrapped it or not. */
export function nameOf(entry: FgmjObject): string | undefined {
  const raw = entry.name;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const wrapped = (raw as FgmjObject).value;
    if (typeof wrapped === 'string') return wrapped;
  }
  return undefined;
}

/** A number, however deeply the schema nested it. */
export function numberOf(value: unknown, depth = 0): number | undefined {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && depth < 4) {
    return numberOf((value as FgmjObject).value, depth + 1);
  }
  return undefined;
}

/** The ISO timestamp out of a time message, offset intact. */
export function timeOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const t = (value as FgmjObject).time;
  return typeof t === 'string' ? t : undefined;
}
