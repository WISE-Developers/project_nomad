/**
 * Ignition geometry, and the projection question (refs #294).
 *
 * THE WORST FAILURE AVAILABLE IN THIS IMPORTER, so it is worth being explicit
 * about what this does not do.
 *
 * An .fgmj names a projection but does not carry one — `projectionName:
 * "dataset"` refers to a .prj that sat beside the author's fuel grid, which no
 * agency ships with a years-old job file. The coordinates themselves may be
 * lat/lon or projected metres depending on what that data used. FireSTARR's CLI
 * takes lat/lon, so a projected file cannot be converted without the CRS.
 *
 * Guessing one is the failure mode: the run completes, looks entirely
 * plausible, and places the fire hundreds of kilometres from where it was. In
 * the sample the real CRS is ESRI:102001 (Canada Albers) and reprojecting puts
 * the ignitions in the NWT — but the FILE does not say that, so this module
 * does not either.
 *
 * Detect, then ask. Classification only; the operator supplies the CRS, and
 * reprojection happens elsewhere with that answer in hand.
 */

import { nameOf, numberOf, timeOf, type FgmjObject } from './fgmjValues.js';
import type { ResolvedScenario } from './resolveScenarios.js';

/** Longitude is bounded at ±180, latitude at ±90. Outside that it is not lat/lon. */
const MAX_LONGITUDE = 180;
const MAX_LATITUDE = 90;

export interface IgnitionPoint {
  x: number;
  y: number;
}

export interface ExtractedIgnition {
  /** The name the file gave this ignition. */
  name: string;
  /** POINT, POLYGON_OUT, and so on, straight from the file. */
  polyType: string;
  points: IgnitionPoint[];
  /** ISO 8601 with the offset the file carried. */
  startTime: string;
  coordinateSystem: 'latLon' | 'projected';
  /**
   * True when the operator must supply a CRS before this can be run.
   * Deliberately explicit rather than left to be inferred from the above.
   */
  requiresCrs: boolean;
  /**
   * Never set here. Present on the type so that the one place a CRS may be
   * attached is an answer from the operator, not a default from this module.
   */
  crs?: string;
  /** Only when the coordinates already are lat/lon; x is longitude, y latitude. */
  latLonPoints?: { lon: number; lat: number }[];
}

function asArray(value: unknown): FgmjObject[] {
  return Array.isArray(value) ? (value as FgmjObject[]) : [];
}

/**
 * Are these coordinates plausibly lat/lon?
 *
 * Every point must be inside the envelope. One point outside means the set is
 * projected — erring toward "projected" asks a question, while erring toward
 * "lat/lon" silently runs the fire in the wrong hemisphere.
 */
function isLatLon(points: IgnitionPoint[]): boolean {
  return points.every(
    (p) => Math.abs(p.x) <= MAX_LONGITUDE && Math.abs(p.y) <= MAX_LATITUDE,
  );
}

export function extractIgnitions(scenario: ResolvedScenario): ExtractedIgnition[] {
  const extracted: ExtractedIgnition[] = [];

  for (const declared of scenario.ignitions) {
    const ignitionName = nameOf(declared) ?? '(unnamed)';
    const inner = (declared.ignition ?? {}) as FgmjObject;

    const startTime = timeOf(inner.startTime);
    if (!startTime) {
      throw new Error(
        `Ignition "${ignitionName}" in scenario "${scenario.name}" has no start time.`,
      );
    }

    const geometries = asArray((inner.ignitions as FgmjObject | undefined)?.ignitions);
    if (geometries.length === 0) {
      throw new Error(
        `Ignition "${ignitionName}" in scenario "${scenario.name}" declares no geometry.`,
      );
    }

    for (const geometry of geometries) {
      const polyType = typeof geometry.polyType === 'string' ? geometry.polyType : undefined;
      if (!polyType) {
        throw new Error(
          `Ignition "${ignitionName}" in scenario "${scenario.name}" has a geometry ` +
            'with no polyType, so its shape cannot be determined.',
        );
      }

      // `polygon.polygon.points` — the outer carries the units label, the inner
      // the vertices. The label is NOT a CRS; see the module header.
      const outer = (geometry.polygon ?? {}) as FgmjObject;
      const polygon = (outer.polygon ?? {}) as FgmjObject;

      const points: IgnitionPoint[] = asArray(polygon.points).map((point, index) => {
        const x = numberOf(point.x);
        const y = numberOf(point.y);
        if (x === undefined || y === undefined) {
          throw new Error(
            `Ignition "${ignitionName}" in scenario "${scenario.name}" has a point ` +
              `at index ${index} missing an x or y coordinate.`,
          );
        }
        return { x, y };
      });

      if (points.length === 0) {
        throw new Error(
          `Ignition "${ignitionName}" in scenario "${scenario.name}" has a ${polyType} ` +
            'geometry with no points. Refusing to import a fire with no location.',
        );
      }

      const latLon = isLatLon(points);

      extracted.push({
        name: ignitionName,
        polyType,
        points,
        startTime,
        coordinateSystem: latLon ? 'latLon' : 'projected',
        requiresCrs: !latLon,
        // crs is deliberately absent: only the operator can supply one.
        ...(latLon
          ? { latLonPoints: points.map((p) => ({ lon: p.x, lat: p.y })) }
          : {}),
      });
    }
  }

  return extracted;
}
