/**
 * FireSTARR cannot simulate an area larger than its grid, and does not say so (#432).
 *
 * `MAX_COLUMNS = MAX_ROWS = 4096` (firestarr-cpp/src/cpp/stdafx.h) at a 100 m
 * fuel resolution is a 409.6 km square. Over-size input is NOT rejected by the
 * engine: ConstantGrid.h centres a 4096-cell window on the ignition and clamps
 * it, so everything outside simply does not exist for the simulation — and the
 * drawn perimeter is cropped the same way (Perimeter.cpp:82 reads it through
 * the same call).
 *
 * The bounds checks that would catch it are inside `#ifdef DEBUG_GRIDS`, which
 * is never defined anywhere in that project, and CMAKE_BUILD_TYPE defaults to
 * Release. So a user who draws a fire spanning three provinces gets a
 * plausible-looking result from a silently truncated domain, with nothing on
 * screen saying so. That is worse than an error.
 *
 * Reported from the CIFFC demo, where a fire was drawn from Alberta to
 * Manitoba — roughly 1,300 km, about 3x the limit.
 *
 * Note on what binds: the AREA limit is 4096^2 ha = 16,777,216 ha, which no
 * real fire approaches (Donnie Creek 2023, BC's largest, was ~620,000 ha). It
 * is EXTENT that fails first, and a long thin fire fails on extent while
 * nowhere near the area.
 */

import { describe, it, expect } from 'vitest';
import { SpatialGeometry } from '../../../domain/entities/index.js';
import {
  checkSimulationExtent,
  MAX_EXTENT_M,
  MAX_GRID_CELLS,
  GRID_RESOLUTION_M,
} from '../simulationExtent.js';

/** Degrees of latitude per metre is near enough constant; 111_320 m per degree. */
const M_PER_DEG_LAT = 111_320;

/** A square-ish polygon centred near Fort Smith, sized in kilometres. */
function polygonSpanningKm(widthKm: number, heightKm: number): SpatialGeometry {
  const lat = 60.0;
  const lon = -111.9;
  const dLat = (heightKm * 1000) / M_PER_DEG_LAT / 2;
  const dLon = (widthKm * 1000) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)) / 2;
  return SpatialGeometry.fromPolygon([
    { lat: lat - dLat, lon: lon - dLon },
    { lat: lat - dLat, lon: lon + dLon },
    { lat: lat + dLat, lon: lon + dLon },
    { lat: lat + dLat, lon: lon - dLon },
    { lat: lat - dLat, lon: lon - dLon },
  ]);
}

describe('simulation extent limit (#432)', () => {
  it('states the limit FireSTARR actually has', () => {
    expect(MAX_GRID_CELLS).toBe(4096);
    expect(GRID_RESOLUTION_M).toBe(100);
    expect(MAX_EXTENT_M).toBe(409_600);
  });

  it('accepts a fire well inside the grid', () => {
    const check = checkSimulationExtent(polygonSpanningKm(50, 50));

    expect(check.withinLimit).toBe(true);
  });

  it('rejects a fire wider than the grid', () => {
    // Alberta to Manitoba, roughly.
    const check = checkSimulationExtent(polygonSpanningKm(1300, 50));

    expect(check.withinLimit).toBe(false);
  });

  it('rejects a fire taller than the grid, not only wider', () => {
    const check = checkSimulationExtent(polygonSpanningKm(50, 900));

    expect(check.withinLimit).toBe(false);
  });

  it('treats a bare ignition point as having no extent', () => {
    const check = checkSimulationExtent(SpatialGeometry.fromPoint(60.0, -111.9));

    expect(check.withinLimit).toBe(true);
    expect(check.widthM).toBe(0);
    expect(check.heightM).toBe(0);
  });

  it('passes when there is no geometry at all', () => {
    expect(checkSimulationExtent(undefined).withinLimit).toBe(true);
  });
});

describe('the rejection explains itself (#432)', () => {
  it('names the measured extent, the limit, and what would otherwise happen', () => {
    // Papa's requirement 2026-10-11: "make sure the reject explains why".
    // A bare "too large" tells an operator nothing about what to change.
    const check = checkSimulationExtent(polygonSpanningKm(1300, 50));
    const reason = check.reason ?? '';

    expect(reason).toMatch(/1[,.]?3\d\d\s*km|1300\s*km/i); // the measured width
    expect(reason).toMatch(/409\.6\s*km/); // the limit
    expect(reason).toMatch(/4096/); // where the limit comes from
    expect(reason).toMatch(/crop|truncat|silently|outside/i); // why it cannot just run
  });

  it('says nothing when the extent is fine', () => {
    expect(checkSimulationExtent(polygonSpanningKm(50, 50)).reason).toBeUndefined();
  });
});
