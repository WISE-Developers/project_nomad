/**
 * The timezone an imported run is expressed in (refs #294).
 *
 * FireSTARRParams asks for "an IANA timezone identifier for ignition location".
 * The .fgmj does not carry one: it records an OFFSET and an abbreviation —
 * "-06:00" with timezone "MDT", timezone_id 131084 — and MDT alone maps to
 * several IANA zones. Turning that into "America/Edmonton" would be a guess of
 * exactly the kind this importer refuses when it meets a missing CRS.
 *
 * It does not need guessing. What the engine ultimately receives is a UTC
 * offset and locally-formatted date/times, computed through Intl — and Intl
 * accepts an OFFSET time zone ("-06:00", ES2024) as readily as a zone name.
 * Luxon, which the weather contract uses, accepts the same string. Verified
 * against the real helpers: computeUtcOffsetHours(date, '-06:00') is -6.
 *
 * So the offset the file carried is what gets used.
 *
 * THE TRADE-OFF: an offset zone has no DST rules. A named zone shifts between
 * MDT and MST; "-06:00" does not. For a file whose every timestamp is written
 * -06:00 that is arguably more faithful than imposing a zone's rules on it, but
 * it is a real limitation — a run crossing a transition would keep the near
 * side's offset throughout. Pinned by a test rather than left as a comment.
 *
 * `UTC-6` is NOT used, though Luxon accepts it: Intl rejects it, and these
 * strings reach both libraries.
 */

const OFFSET = /([+-])(\d{2}):?(\d{2})$/;

/**
 * The offset carried by an ISO timestamp, in the one spelling both Intl and
 * Luxon accept.
 *
 * @throws if the timestamp has no offset. A local time with no offset cannot be
 *         placed on a clock without inventing a zone, and inventing one is how
 *         a run ends up hours away from where it was meant to be.
 */
export function timezoneOf(iso: string): string {
  if (/[Zz]$/.test(iso)) return '+00:00';

  const match = OFFSET.exec(iso);
  if (!match) {
    throw new Error(
      `Timestamp "${iso}" carries no UTC offset, so the timezone of the run cannot be ` +
        'determined. The .fgmj records an offset on its scenario times; refusing to ' +
        'guess one.',
    );
  }

  const [, sign, hours, minutes] = match;
  return `${sign}${hours}:${minutes}`;
}
