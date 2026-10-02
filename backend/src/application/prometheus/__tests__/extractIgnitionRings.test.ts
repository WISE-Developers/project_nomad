/**
 * Ignition geometry as RINGS, because a fire perimeter can have holes
 * (refs #294).
 *
 * The schema is explicit about this. `Geography.GeoPoly` is a oneof:
 *
 *   polygon: Math.XYPolygon   a SINGLE ring — points[]
 *   polyset: Math.XYPolySet   MULTIPLE entries, each with isHole: bool
 *
 * So holes are FLAGGED, not inferred from winding order, and a polygon with an
 * unburned island inside it arrives as a polyset. Flattening that to one ring
 * would burn the island — the fire would be bigger than the file describes, in
 * a run that completes and looks plausible.
 *
 * An earlier version of this module read only the `polygon` branch and exposed
 * a flat `points` array, which cannot represent a hole at all. Rings replace
 * it.
 *
 * NO FIXTURE USES THE polyset BRANCH. All four real files carry a single ring.
 * So the hole cases here are driven by synthetic scenarios shaped to the
 * schema, the same way the `Disable` operation is — stated plainly rather than
 * dressed up as artifact coverage.
 *
 * Note `isHole` is a bool, so proto3 omits it when false: an absent flag means
 * an exterior ring, exactly as an absent zero means zero elsewhere in here.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFgmjProject } from '../loadFgmjProject.js';
import { resolveScenarios, type ResolvedScenario } from '../resolveScenarios.js';
import { extractIgnitions } from '../extractIgnitions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (n: string) => path.join(TEST_DATA, n);
const THREE = 'prometheus_job_SS008-25_3scenarios.fgmj';

const best = () => resolveScenarios(loadFgmjProject(fixture(THREE)))[0];

/** A scenario carrying one ignition whose geometry is whatever is passed in. */
function scenarioWithGeometry(geometry: Record<string, unknown>): ResolvedScenario {
  const scenario = best();
  const ignition = scenario.ignitions[0] as Record<string, unknown>;
  const inner = ignition.ignition as Record<string, unknown>;
  (inner.ignitions as Record<string, unknown>).ignitions = [geometry];
  return scenario;
}

const pt = (x: number, y: number) => ({ x: { value: x }, y: { value: y } });

/** A square, in lat/lon so no CRS is needed for these shape tests. */
const OUTER = [pt(-116, 60), pt(-115, 60), pt(-115, 61), pt(-116, 61)];
const INNER = [pt(-115.8, 60.2), pt(-115.6, 60.2), pt(-115.6, 60.4), pt(-115.8, 60.4)];

describe('extractIgnitions — rings', () => {
  describe('the real corpus uses the single-ring branch', () => {
    it('gives one exterior ring with every vertex', () => {
      const [ignition] = extractIgnitions(best());

      expect(ignition.rings).toHaveLength(1);
      expect(ignition.rings[0].isHole).toBe(false);
      expect(ignition.rings[0].points).toHaveLength(381);
      expect(ignition.rings[0].points[0].x).toBeCloseTo(-1114437.3566378944, 6);
    });

    it('still reports the whole thing as projected', () => {
      const [ignition] = extractIgnitions(best());

      expect(ignition.coordinateSystem).toBe('projected');
      expect(ignition.requiresCrs).toBe(true);
    });
  });

  describe('the polyset branch, which carries holes', () => {
    it('reads an exterior ring and an interior one', () => {
      const ignitions = extractIgnitions(
        scenarioWithGeometry({
          polyType: 'POLYGON_OUT',
          polygon: {
            units: 'UTM',
            polyset: {
              polys: [
                { polyType: 'Polygon', polygon: { points: OUTER } },
                { polyType: 'Polygon', isHole: true, polygon: { points: INNER } },
              ],
            },
          },
        }),
      );

      expect(ignitions[0].rings).toHaveLength(2);
      expect(ignitions[0].rings[0].isHole).toBe(false);
      expect(ignitions[0].rings[1].isHole).toBe(true);
      expect(ignitions[0].rings[1].points).toHaveLength(4);
    });

    it('treats an absent isHole as exterior, since proto3 drops a false', () => {
      const ignitions = extractIgnitions(
        scenarioWithGeometry({
          polyType: 'POLYGON_OUT',
          polygon: {
            units: 'UTM',
            polyset: { polys: [{ polyType: 'Polygon', polygon: { points: OUTER } }] },
          },
        }),
      );

      expect(ignitions[0].rings[0].isHole).toBe(false);
    });

    it('classifies coordinates across ALL rings, not just the first', () => {
      // Exterior in lat/lon, hole in projected metres — incoherent, and the
      // safe reading is "projected", which asks a question instead of running
      // the fire in the wrong hemisphere.
      const ignitions = extractIgnitions(
        scenarioWithGeometry({
          polyType: 'POLYGON_OUT',
          polygon: {
            units: 'UTM',
            polyset: {
              polys: [
                { polyType: 'Polygon', polygon: { points: OUTER } },
                {
                  polyType: 'Polygon',
                  isHole: true,
                  polygon: { points: [pt(-1114437, 2423419), pt(-1114000, 2423419)] },
                },
              ],
            },
          },
        }),
      );

      expect(ignitions[0].coordinateSystem).toBe('projected');
      expect(ignitions[0].requiresCrs).toBe(true);
    });

    it('refuses a hole with no exterior ring to belong to', () => {
      expect(() =>
        extractIgnitions(
          scenarioWithGeometry({
            polyType: 'POLYGON_OUT',
            polygon: {
              units: 'UTM',
              polyset: {
                polys: [{ polyType: 'Polygon', isHole: true, polygon: { points: INNER } }],
              },
            },
          }),
        ),
      ).toThrow(/hole/i);
    });

    it('refuses a polyset entry whose own type is not a polygon', () => {
      // PolySetEntry.polyType is {Multipoint, Polyline, Polygon}. A set mixing
      // them is not a perimeter, and guessing which part to keep would be
      // inventing geometry.
      expect(() =>
        extractIgnitions(
          scenarioWithGeometry({
            polyType: 'POLYGON_OUT',
            polygon: {
              units: 'UTM',
              polyset: {
                polys: [
                  { polyType: 'Polygon', polygon: { points: OUTER } },
                  { polyType: 'Polyline', polygon: { points: INNER } },
                ],
              },
            },
          }),
        ),
      ).toThrow(/Polyline|polygon/i);
    });
  });

  describe('stop and alert', () => {
    it('refuses a geometry with neither oneof branch set', () => {
      expect(() =>
        extractIgnitions(
          scenarioWithGeometry({ polyType: 'POLYGON_OUT', polygon: { units: 'UTM' } }),
        ),
      ).toThrow(/geometry|ring|point/i);
    });

    it('refuses an empty polyset', () => {
      expect(() =>
        extractIgnitions(
          scenarioWithGeometry({
            polyType: 'POLYGON_OUT',
            polygon: { units: 'UTM', polyset: { polys: [] } },
          }),
        ),
      ).toThrow(/ring|point|empty/i);
    });
  });
});
