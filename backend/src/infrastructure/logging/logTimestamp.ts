/**
 * Log-line timestamps — issue #371.
 *
 * Timestamps in a log are read long after the fact, usually while lining
 * events up against records from other systems. That only works if each
 * line says which zone it is in. The previous implementation built the
 * string from `getFullYear()`, `getHours()` and friends — the process's
 * own zone — and emitted no label, so a reader had to already know how the
 * container was configured in order to interpret it. In practice the
 * container runs UTC while the deployment's home zone is something else
 * entirely, which is the worst version of that: it looks local and isn't.
 *
 * The zone is now explicit on every line. This matters more than usual for
 * NWT and Alberta deployments, where the offset stops shifting seasonally
 * on 2026-11-01 (see #364): logs written either side of that date are only
 * comparable if each one states its own offset rather than relying on the
 * reader to infer the rule in force at the time.
 */

/** Zero-pads to a fixed width. */
function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/**
 * Reads the parts of an instant as they appear in a given zone, and the
 * zone's offset from UTC at that moment.
 */
function partsIn(date: Date, timeZone: string): { wall: string; offsetMinutes: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  const wall =
    `${parts.year}-${parts.month}-${parts.day} ` +
    `${parts.hour}:${parts.minute}:${parts.second}.${pad(date.getMilliseconds(), 3)}`;

  // Read the zone's wall clock back as if it were UTC; the difference from
  // the real instant is the offset. Derived rather than assumed, so DST and
  // half-hour zones need no special cases -- and so a zone that stops
  // observing DST is handled without a code change.
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMinutes = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);

  return { wall, offsetMinutes };
}

/** Renders an offset in minutes as `+HH:MM` / `-HH:MM`. */
function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Formats an instant as `YYYY-MM-DD HH:mm:ss.SSS ±HH:MM`.
 *
 * @param date     the instant to render
 * @param timeZone IANA zone name. Defaults to `NOMAD_HOME_TIMEZONE` so logs
 *                 read in the deployment's own zone, then to UTC.
 *
 * Never throws. Logging must not be the thing that takes the process down,
 * so an unusable zone degrades to a labelled UTC line rather than losing
 * the entry. The label is what makes that degradation safe: a reader can
 * always see which zone they got.
 */
export function formatLogTimestamp(date: Date, timeZone?: string): string {
  const zone = timeZone ?? process.env.NOMAD_HOME_TIMEZONE ?? 'UTC';

  try {
    const { wall, offsetMinutes } = partsIn(date, zone);
    return `${wall} ${formatOffset(offsetMinutes)}`;
  } catch {
    const { wall, offsetMinutes } = partsIn(date, 'UTC');
    return `${wall} ${formatOffset(offsetMinutes)}`;
  }
}
