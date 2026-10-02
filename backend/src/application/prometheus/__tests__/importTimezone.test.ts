/**
 * The timezone an imported run is expressed in (refs #294).
 *
 * FireSTARRParams wants an "IANA timezone identifier for ignition location".
 * The .fgmj does not carry one. It records an OFFSET and an abbreviation —
 * "-06:00" with timezone "MDT", timezone_id 131084 — and MDT alone maps to
 * several IANA zones, so turning it into "America/Edmonton" would be a guess of
 * exactly the kind this importer refuses elsewhere.
 *
 * It does not need to be guessed. What the engine ultimately receives is an
 * offset and locally-formatted date/times, computed via Intl — and Intl accepts
 * an OFFSET time zone ("-06:00", ES2024) as readily as a zone name. Luxon,
 * which the weather contract uses, accepts the same string. So the offset the
 * file carried is passed through, and nothing is invented.
 *
 * Asserted against the REAL downstream helpers rather than a local
 * re-derivation, because the question is not "can I parse an offset" but "does
 * the code that will consume this accept it".
 *
 * THE TRADE-OFF, tested rather than only commented: an offset zone has no DST
 * rules. A true zone shifts between MDT and MST; "-06:00" does not. For a file
 * whose every timestamp is written -06:00 that is arguably more faithful than
 * imposing a zone's rules on it, but it is a real limitation and the last case
 * here pins it so nobody discovers it by surprise.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { DateTime } from 'luxon';
import { planFgmjImport } from '../planFgmjImport.js';
import { timezoneOf } from '../importTimezone.js';
import {
  computeUtcOffsetHours,
  formatLocalDate,
  formatLocalTime,
} from '../../../infrastructure/firestarr/timezoneUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (n: string) => path.join(TEST_DATA, n);
const THREE = 'prometheus_job_SS008-25_3scenarios.fgmj';

/** 2025-06-26 18:00Z is 12:00 local at -06:00 — the noon FireSTARR cares about. */
const NOON_LOCAL = new Date('2025-06-26T18:00:00Z');

describe('timezoneOf', () => {
  it('takes the offset the file carried', () => {
    expect(timezoneOf('2025-06-26T13:00:00-06:00')).toBe('-06:00');
  });

  it('normalises a Z suffix', () => {
    expect(timezoneOf('2025-06-26T13:00:00Z')).toBe('+00:00');
  });

  it('keeps a half-hour offset', () => {
    expect(timezoneOf('2025-06-26T13:00:00+05:30')).toBe('+05:30');
  });

  it('accepts an offset written without a colon', () => {
    expect(timezoneOf('2025-06-26T13:00:00-0600')).toBe('-06:00');
  });

  it('refuses a timestamp with no offset rather than guessing', () => {
    expect(() => timezoneOf('2025-06-26T13:00:00')).toThrow(/offset/i);
  });
});

describe('the plan carries it', () => {
  it('sets the timezone on every scenario of every fixture', () => {
    for (const f of [
      THREE,
      'prometheus_job_sage1_patches_multiignition.fgmj',
      'prometheus_job_sage2_polygon_winddirection.fgmj',
      'prometheus_job_sage3_divide_compass.fgmj',
    ]) {
      for (const plan of planFgmjImport(fixture(f))) {
        expect(plan.timezone, `${f} / ${plan.scenarioName}`).toBe('-06:00');
      }
    }
  });
});

describe('the code that will consume it accepts it', () => {
  it('works with FireSTARR’s own offset calculation', () => {
    const [best] = planFgmjImport(fixture(THREE));

    expect(computeUtcOffsetHours(NOON_LOCAL, best.timezone)).toBe(-6);
  });

  it('works with FireSTARR’s own local date and time formatting', () => {
    const [best] = planFgmjImport(fixture(THREE));

    expect(formatLocalDate(NOON_LOCAL, best.timezone)).toBe('2025-06-26');
    expect(formatLocalTime(NOON_LOCAL, best.timezone)).toBe('12:00');
  });

  it('works with Luxon, which the weather contract uses', () => {
    const [best] = planFgmjImport(fixture(THREE));
    const zoned = DateTime.fromJSDate(NOON_LOCAL, { zone: best.timezone });

    expect(zoned.isValid).toBe(true);
    expect(zoned.hour).toBe(12);
    expect(zoned.toFormat('yyyy-MM-dd')).toBe('2025-06-26');
  });
});

describe('the DST trade-off this accepts', () => {
  it('does not shift across a transition, where a named zone would', () => {
    const [best] = planFgmjImport(fixture(THREE));
    const january = new Date('2025-01-15T18:00:00Z');

    // The file's offset is fixed, so it stays -6 all year.
    expect(computeUtcOffsetHours(january, best.timezone)).toBe(-6);
    // A real zone for the same place would be -7 in January.
    expect(computeUtcOffsetHours(january, 'America/Edmonton')).toBe(-7);
  });
});
