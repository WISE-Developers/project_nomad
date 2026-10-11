/**
 * Whether a fire fits inside the area FireSTARR can actually simulate (#432).
 *
 * FireSTARR's environment grid is fixed:
 *
 *     static constexpr Idx MAX_COLUMNS = 4096;      // firestarr-cpp stdafx.h
 *     static constexpr Idx MAX_ROWS    = MAX_COLUMNS;
 *
 * At the 100 m fuel resolution that is a 409.6 km square.
 *
 * The engine does NOT reject anything larger. `ConstantGrid.h` centres a
 * 4096-cell window on the ignition and clamps it to the dataset bounds, so
 * everything outside that window simply does not exist for the simulation —
 * and the drawn perimeter is cropped identically, because `Perimeter.cpp`
 * reads it through the same call. The bounds checks that would catch this sit
 * inside `#ifdef DEBUG_GRIDS`, which is never defined anywhere in that
 * project, and its build defaults to Release.
 *
 * So an over-size fire does not fail. It produces a plausible-looking result
 * from a silently truncated domain, with nothing on screen saying so — which
 * is worse than an error, because the operator has no reason to doubt it.
 * Reported from the CIFFC demo, where a fire was drawn from Alberta to
 * Manitoba, roughly 1,300 km across.
 *
 * Note which limit binds. The AREA ceiling is 4096² = 16,777,216 ha (a 100 m
 * cell is exactly one hectare), which no real fire approaches — Donnie Creek
 * in 2023, the largest on record in BC, was about 620,000 ha. EXTENT fails
 * first, and a long thin fire blows the bounding box while nowhere near the
 * area.
 *
 * This lives in the FireSTARR adapter rather than the domain because it is a
 * property of this engine, not of fire modelling. A different engine would
 * have a different grid.
 */

import type { SpatialGeometry } from '../../domain/entities/index.js';

/** Cells per side of the FireSTARR environment grid (stdafx.h MAX_COLUMNS). */
export const MAX_GRID_CELLS = 4096;

/** Fuel grid resolution in metres. Verified against a real output raster. */
export const GRID_RESOLUTION_M = 100;

/** The largest span FireSTARR can represent on one axis: 409.6 km. */
export const MAX_EXTENT_M = MAX_GRID_CELLS * GRID_RESOLUTION_M;

/** Metres per degree of latitude. Near enough constant. */
const M_PER_DEGREE_LAT = 111_320;

export interface ExtentCheck {
  readonly withinLimit: boolean;
  /** East-west span of the geometry's bounding box, in metres. */
  readonly widthM: number;
  /** North-south span of the geometry's bounding box, in metres. */
  readonly heightM: number;
  /** Present only when the limit is exceeded. Written to be read by an operator. */
  readonly reason?: string;
}

function formatKm(metres: number): string {
  const km = metres / 1000;
  // Under 10 km a whole number hides the difference between 2 km and 2.4 km.
  return km >= 10 ? `${Math.round(km).toLocaleString('en-CA')} km` : `${km.toFixed(1)} km`;
}

/**
 * The limit, stated exactly, because rounding it is actively unhelpful here:
 * an operator sizing a fire near the edge needs 409.6, not 410. Measurements
 * are rounded; the limit never is. Derived from the constant so the two
 * cannot drift apart.
 */
const MAX_EXTENT_LABEL = `${(MAX_EXTENT_M / 1000).toFixed(1)} km`;

/**
 * Measures the geometry's bounding box against the grid.
 *
 * The conversion from degrees is deliberately approximate: longitude degrees
 * are scaled by cos(latitude) at the box's mid-latitude. The fuel grids are
 * projected UTM, so this is not the exact grid-space extent — but the check
 * only has to separate "fits comfortably" from "three times too wide", and
 * the real cases are not marginal. Being approximate is stated rather than
 * hidden, because a reader who assumes exactness would mis-set any future
 * threshold derived from it.
 */
export function checkSimulationExtent(geometry: SpatialGeometry | undefined): ExtentCheck {
  if (!geometry) {
    // Nothing to measure is not a failure — a run may be driven by a point.
    return { withinLimit: true, widthM: 0, heightM: 0 };
  }

  const [minLon, minLat, maxLon, maxLat] = geometry.getBoundingBox();

  const heightM = (maxLat - minLat) * M_PER_DEGREE_LAT;
  const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const widthM = (maxLon - minLon) * M_PER_DEGREE_LAT * Math.cos(midLatRad);

  if (widthM <= MAX_EXTENT_M && heightM <= MAX_EXTENT_M) {
    return { withinLimit: true, widthM, heightM };
  }

  const axis = widthM > MAX_EXTENT_M && heightM > MAX_EXTENT_M
    ? 'in both directions'
    : widthM > MAX_EXTENT_M
      ? 'east to west'
      : 'north to south';

  // Says what was measured, what the limit is, where the limit comes from,
  // why the run cannot simply proceed, and what to do about it. A bare
  // "area too large" tells an operator nothing they can act on.
  const reason =
    `This fire spans ${formatKm(widthM)} east-west and ${formatKm(heightM)} north-south, ` +
    `which is too large ${axis}. ` +
    `FireSTARR can only simulate a ${MAX_EXTENT_LABEL} square: its grid is fixed at ` +
    `${MAX_GRID_CELLS} cells of ${GRID_RESOLUTION_M} m. ` +
    `A larger area is not refused by the engine — it silently crops the simulation to a ` +
    `${MAX_EXTENT_LABEL} window centred on the ignition, so everything outside that ` +
    `window would be left out of the results with nothing to indicate it. ` +
    `Draw a fire smaller than ${MAX_EXTENT_LABEL} across, or split this into separate models.`;

  return { withinLimit: false, widthM, heightM, reason };
}
