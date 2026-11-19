import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvironmentService } from '../EnvironmentService.js';

/**
 * #282: the fuel grid's nil value is CONFIGURATION, and it is REQUIRED.
 *
 * The CFS WCS declares no nil value of its own — `swe:nilValues` is empty and the
 * GeoTIFF carries no NoData tag (measured 2026-11-04). Without one, Nomad cannot tell
 * an absent pixel from a fuel class it failed to decode.
 *
 * The decision (Franco, 2026-11-17) is that the value lives in configuration so it can
 * change without a code change, and that it is UNSET until somebody chooses it. There is
 * deliberately NO default and NO seeded placeholder: a seed would let the fuel path run
 * against a nil value nobody chose, which is the exact failure this exists to prevent.
 * Same fail-fast contract as NOMAD_HOME_TIMEZONE.
 */
describe('EnvironmentService.getFuelNoDataValue (#282)', () => {
  const KEY = 'NOMAD_FUEL_NODATA_VALUE';
  const original = process.env[KEY];

  beforeEach(() => {
    EnvironmentService.resetInstance();
    delete process.env[KEY];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = original;
    }
    EnvironmentService.resetInstance();
  });

  it('throws when the key is not set — no default, ever', () => {
    expect(() => EnvironmentService.getInstance().getFuelNoDataValue()).toThrow(
      /NOMAD_FUEL_NODATA_VALUE/
    );
  });

  it('does not fall back to any value when unset', () => {
    let result: number | undefined;
    try {
      result = EnvironmentService.getInstance().getFuelNoDataValue();
    } catch {
      result = undefined;
    }
    expect(result).toBeUndefined();
  });

  it.each(['', ' ', 'abc', '1.5', 'NaN', '1e3x'])(
    'throws when the value is not an integer: %p',
    raw => {
      process.env[KEY] = raw;
      expect(() => EnvironmentService.getInstance().getFuelNoDataValue()).toThrow(
        /NOMAD_FUEL_NODATA_VALUE/
      );
    }
  );

  it.each([
    ['-9999', -9999],
    ['99999', 99999],
    [' 32767 ', 32767],
  ])('returns the integer when set to %p', (raw, expected) => {
    process.env[KEY] = raw as string;
    expect(EnvironmentService.getInstance().getFuelNoDataValue()).toBe(expected);
  });

  /**
   * CONTROL, and the one case most likely to be got wrong. `getRequired` rejects on a
   * FALSY string, and "0" is the value this key is most likely to hold: it is what the
   * live coverage uses past its data edge (measured 2026-11-16, issue comment
   * 6920174616). An implementation built on `getRequired` alone would reject the real
   * answer while passing every other assertion in this file.
   */
  it('accepts 0, which a falsy-string check would wrongly reject', () => {
    process.env[KEY] = '0';
    expect(EnvironmentService.getInstance().getFuelNoDataValue()).toBe(0);
  });
});
