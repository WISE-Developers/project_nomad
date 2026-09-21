/**
 * Timestamp formatting for exported map captures — issue #369.
 *
 * The capture's metadata strip is burned into a PNG or PDF and then leaves
 * the application. Unlike anything rendered in the UI, the reader cannot
 * ask the app what zone a number meant: the artifact is all they have.
 *
 * So the zone travels with the value, always. `timeZoneName` is the whole
 * point of this module, not a detail of it.
 */

/** Fields shared by every rendering, so captures are comparable. */
const BASE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZoneName: 'short',
};

/**
 * Formats the moment a capture was taken, always labelled with its zone.
 *
 * @param date     the instant of capture
 * @param timeZone IANA zone to render in. Omitted means the viewer's own
 *                 zone — acceptable, because this records when the capture
 *                 was made rather than anything about the fire. What is not
 *                 acceptable is leaving the reader unable to tell which.
 */
export function formatCaptureTimestamp(date: Date, timeZone?: string): string {
  try {
    return date.toLocaleString(undefined, {
      ...BASE_FORMAT,
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    // An unusable zone must not cost the operator their capture. Fall back
    // to the viewer's zone, still labelled, rather than aborting the export
    // or — worse — emitting an unlabelled time.
    try {
      return date.toLocaleString(undefined, BASE_FORMAT);
    } catch {
      // Last resort: ISO-8601, which carries its own offset.
      return date.toISOString();
    }
  }
}
