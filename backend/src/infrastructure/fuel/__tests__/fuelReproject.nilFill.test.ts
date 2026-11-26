import { describe, it, expect } from 'vitest';
import { buildFuelWarpArgs, assertClassDomainPreserved } from '../fuelReproject.js';

/**
 * #282 Step 3 found this on the first real coverage, and it is worth recording how.
 *
 * Reprojecting a rectangle from EPSG:3978 into UTM produces a ROTATED quadrilateral, so
 * the output rectangle has corners the source never covered. gdalwarp fills them — and
 * with nothing told to it, it fills them with 0 and declares no NoData at all. Measured
 * 2026-11-18 on fbp100m2026wcs: the fetched window's values ran 1..675 with no 0 present,
 * and the reprojected grid's corner pixel read 0.
 *
 * TWO SEPARATE FAULTS CAME OUT OF THAT ONE NUMBER, and only the first is obvious.
 *
 * 1. `assertClassDomainPreserved` reported "reprojection invented 1 class(es): 0" and was
 *    RIGHT to notice — a value appeared that the source did not contain. But the absence
 *    marker is not an invented fuel class, and the check had no way to know which value
 *    meant absence, so it failed a correct reprojection.
 *
 * 2. The worse one. The fill value was GDAL's choice, not ours. With a declared nil of 0
 *    the pixels happen to look right while carrying no NoData tag; with a declared nil of
 *    -9999 the corners would be filled with 0 instead — and 0 is a legitimate value for
 *    this key, so the corners would read as a real fuel class and a fire could spread
 *    through ground the coverage never described. Nothing downstream would say so.
 *
 * So the warp is told the fill explicitly, and the domain check is told which value means
 * absent. Fixing only the first would have silenced the symptom and left the second.
 */
describe('reprojection fill and the declared nil (#282)', () => {
  // #563: `utmZone: 11` became `targetEpsg: 32611` — the same code zone 11 composed, so
  // no assertion in this file changes. Nothing here asserts the CRS; it is all nil fill.
  const base = { sourcePath: '/in.tif', targetPath: '/out.tif', targetEpsg: 32611, resolutionM: 100 };

  it('tells gdalwarp the declared nil to fill with, rather than letting it choose', () => {
    const args = buildFuelWarpArgs({ ...base, nilValue: -9999 });
    expect(args).toContain('-dstnodata');
    expect(args[args.indexOf('-dstnodata') + 1]).toBe('-9999');
  });

  it('passes a nil of 0 through, because 0 is a legitimate declared value', () => {
    // Number 0 is falsy, so any `if (nilValue)` guard would drop exactly the value the
    // live coverage uses. The same trap EnvironmentService.getFuelNoDataValue avoids by
    // not using getRequired.
    const args = buildFuelWarpArgs({ ...base, nilValue: 0 });
    expect(args).toContain('-dstnodata');
    expect(args[args.indexOf('-dstnodata') + 1]).toBe('0');
  });

  it('omits -dstnodata only when no nil value is supplied', () => {
    // The pre-existing shape, kept so this is additive. The production seam always
    // supplies one, which fuelGridForRun's own suite asserts.
    expect(buildFuelWarpArgs(base)).not.toContain('-dstnodata');
  });

  it('does not treat the declared nil as an invented class', () => {
    // Source has no 0; output does, because the corners were filled.
    expect(() => assertClassDomainPreserved([1, 2, 675], [1, 2, 675, 0], 0)).not.toThrow();
  });

  it('still catches a genuinely invented class when a nil is declared', () => {
    // The check must stay sharp: exempting the nil must not exempt everything. 376 is
    // the real signature of a blended kernel — 650 against 102 averages to it.
    expect(() => assertClassDomainPreserved([1, 2, 675], [1, 2, 675, 0, 376], 0)).toThrow(/376/);
  });

  it('exempts ONLY the declared nil, not any absent-looking value', () => {
    expect(() => assertClassDomainPreserved([1, 2], [1, 2, -9999], 0)).toThrow(/-9999/);
  });

  it('with no nil declared, nothing is exempt — the behaviour it always had', () => {
    expect(() => assertClassDomainPreserved([1, 2], [1, 2, 0])).toThrow(/0/);
  });
});
