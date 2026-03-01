/**
 * Date formatting utilities
 *
 * All formatting uses 24-hour clock (hour12: false) for consistency across the UI.
 */

/**
 * Format a date and optional time string into a human-readable locale string.
 * Uses 24-hour clock format throughout.
 *
 * @param dateStr - ISO date string (YYYY-MM-DD)
 * @param timeStr - Optional time string (HH:MM), defaults to '00:00'
 * @returns Formatted date/time string, or empty string if input is empty or invalid
 */
export function formatDateTime(dateStr: string, timeStr: string = '00:00'): string {
  if (!dateStr) return '';

  try {
    const date = new Date(`${dateStr}T${timeStr}`);

    if (isNaN(date.getTime())) return '';

    return date.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}
