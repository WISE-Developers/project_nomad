/**
 * Local calendar helpers — issue #352.
 *
 * DMC and DC are DAILY codes. They must update once per LOCAL day, driven by
 * the observation nearest local noon, because CFFDRS defines them against noon
 * LST conditions. The previous code rolled them over on the UTC day boundary,
 * which in Edmonton is 18:00 the previous local day.
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { localDayKey, localMonth, pickDailyDriverIndices } from '../localCalendar.js';

const ZONE = 'America/Edmonton';

/** A row as the parser produces one: naive local timestamp read in the zone. */
function at(csvTimestamp: string, zone: string = ZONE): Date {
  return DateTime.fromSQL(csvTimestamp, { zone }).toJSDate();
}

describe('localDayKey', () => {
  it('keeps a whole local day on one key, across the UTC midnight boundary', () => {
    // 18:00 local is when UTC rolls over in MDT. Both belong to Aug 4 locally.
    expect(localDayKey(at('2026-08-04 17:00:00'), ZONE)).toBe('2026-08-04');
    expect(localDayKey(at('2026-08-04 19:00:00'), ZONE)).toBe('2026-08-04');
  });

  it('separates adjacent local days', () => {
    expect(localDayKey(at('2026-08-04 23:00:00'), ZONE)).toBe('2026-08-04');
    expect(localDayKey(at('2026-08-05 00:00:00'), ZONE)).toBe('2026-08-05');
  });

  it('reads the day in the supplied zone, not the server zone', () => {
    const instant = at('2026-08-04 23:00:00', 'UTC');
    expect(localDayKey(instant, 'UTC')).toBe('2026-08-04');
    expect(localDayKey(instant, ZONE)).toBe('2026-08-04');
    expect(localDayKey(instant, 'Asia/Tokyo')).toBe('2026-08-05');
  });
});

describe('localMonth', () => {
  it('is 1-based', () => {
    expect(localMonth(at('2026-08-04 12:00:00'), ZONE)).toBe(8);
  });

  it('does not spill into the next month on the last local evening', () => {
    // 20:00 local on Jul 31 is Aug 1 in UTC. The day-length factor must still
    // be July's.
    expect(localMonth(at('2026-07-31 20:00:00'), ZONE)).toBe(7);
  });

  it('does not fall back into the previous month on the first local morning', () => {
    expect(localMonth(at('2026-08-01 01:00:00'), ZONE)).toBe(8);
  });
});

describe('pickDailyDriverIndices', () => {
  function hourly(day: string, hours: number[]): Date[] {
    return hours.map((h) => at(`${day} ${String(h).padStart(2, '0')}:00:00`));
  }

  it('picks the noon observation to drive the day', () => {
    const rows = hourly('2026-08-04', [0, 6, 12, 18, 23]);
    const picked = pickDailyDriverIndices(rows, ZONE);

    expect(picked.size).toBe(1);
    expect(picked.get('2026-08-04')).toBe(2); // the 12:00 row
  });

  it('picks the observation NEAREST noon when there is no noon row', () => {
    // Stations poll at :06, or start mid-morning. Nearest is well defined.
    const rows = hourly('2026-08-04', [7, 11, 15]);
    const picked = pickDailyDriverIndices(rows, ZONE);

    expect(picked.get('2026-08-04')).toBe(1); // 11:00, one hour from noon
  });

  it('gives each local day its own driver', () => {
    const rows = [...hourly('2026-08-04', [0, 12, 23]), ...hourly('2026-08-05', [0, 12])];
    const picked = pickDailyDriverIndices(rows, ZONE);

    expect(picked.size).toBe(2);
    expect(picked.get('2026-08-04')).toBe(1);
    expect(picked.get('2026-08-05')).toBe(4);
  });

  it('does NOT split one local day at the UTC boundary', () => {
    // The whole bug: 18:00 and 19:00 local are the next UTC day, but the same
    // local day, and must not trigger a second daily update.
    const rows = hourly('2026-08-04', [12, 17, 18, 19, 23]);
    const picked = pickDailyDriverIndices(rows, ZONE);

    expect(picked.size).toBe(1);
  });

  it('prefers the earlier observation when two are equally near noon', () => {
    const rows = hourly('2026-08-04', [11, 13]);
    const picked = pickDailyDriverIndices(rows, ZONE);

    expect(picked.get('2026-08-04')).toBe(0);
  });

  it('handles an empty file', () => {
    expect(pickDailyDriverIndices([], ZONE).size).toBe(0);
  });
});
