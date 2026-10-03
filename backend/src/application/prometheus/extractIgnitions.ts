/**
 * Ignition geometry, and the projection question (refs #294).
 *
 * THE WORST FAILURE AVAILABLE IN THIS IMPORTER, so it is worth being explicit
 * about what this does not do.
 *
 * The coordinates may be lat/lon or projected metres depending on what the
 * author's data used. FireSTARR's CLI takes lat/lon, so a projected file
 * cannot be converted without the CRS.
 *
 * Guessing one is the failure mode: the run completes, looks entirely
 * plausible, and places the fire hundreds of kilometres from where it was.
 *
 * CORRECTED 2026-10-03. This header used to say "an .fgmj names a projection
 * but does not carry one", and that the file does not say its CRS. It usually
 * does. Of 66 real .fgmj files, 5 carry a full WKT inline at
 * grid.projection.wkt and 55 name a .prj — normally "Inputs/dataset.prj" —
 * that is still sitting beside the job. Only 6 genuinely state nothing.
 *
 * Two things hid it. The projection object carries `filename: "dataset"`
 * alongside the definition, and reading the filename answers a different
 * question than reading the WKT. And every field in it is a protobuf
 * StringValue, so `"wkt": "PROJCS[...]"` decodes to `{ value: "PROJCS[...]" }`
 * and a plain-string read returns undefined — indistinguishable from absent.
 * Hence the old note that "the sample really is ESRI:102001 (Canada Albers)
 * ... but the FILE does not say that". It said so all along, in the object
 * being read.
 *
 * projectionFromFile now answers it from the file where the file answers it.
 * This module is unchanged in what it does: it still classifies, still never
 * guesses, and still sets requiresCrs for coordinates it cannot place.
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

/**
 * One ring of an ignition perimeter.
 *
 * `isHole` comes from the schema's own flag — Math.XYPolySet.PolySetEntry
 * declares `isHole: bool` — so an unburned island inside a fire is marked
 * rather than inferred from winding order. It is a bool, so proto3 omits a
 * false: an absent flag means an exterior ring.
 */
export interface IgnitionRing {
  points: IgnitionPoint[];
  isHole: boolean;
}

export interface ExtractedIgnition {
  /** The name the file gave this ignition. */
  name: string;
  /** POINT, POLYGON_OUT, and so on, straight from the file. */
  polyType: string;
  /**
   * Exterior ring first, then any holes.
   *
   * NOT a flat point list. A perimeter with an unburned island cannot be
   * expressed as one ring, and flattening it would burn the island — a bigger
   * fire than the file describes, in a run that looks entirely plausible.
   */
  rings: IgnitionRing[];
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
  /** Only when the coordinates already are lat/lon. Same ring order. */
  latLonRings?: { isHole: boolean; points: { lon: number; lat: number }[] }[];
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
function isLatLon(rings: IgnitionRing[]): boolean {
  return rings.every((ring) =>
    ring.points.every(
      (p) => Math.abs(p.x) <= MAX_LONGITUDE && Math.abs(p.y) <= MAX_LATITUDE,
    ),
  );
}

/** PolySetEntry.polyType is {Multipoint:0, Polyline:1, Polygon:2}. */
const POLYSET_POLYGON = 'Polygon';

function pointsOf(
  polygon: FgmjObject,
  where: string,
  ringLabel: string,
): IgnitionPoint[] {
  return asArray(polygon.points).map((point, index) => {
    const x = numberOf(point.x);
    const y = numberOf(point.y);
    if (x === undefined || y === undefined) {
      throw new Error(
        `${where} has a point at index ${index} of ${ringLabel} missing an x or y ` +
          'coordinate.',
      );
    }
    return { x, y };
  });
}

/**
 * Read the rings out of a Geography.GeoPoly.
 *
 * The oneof has two branches: `polygon` is a single ring, `polyset` is a set of
 * entries each carrying its own isHole flag. Both occur in the schema; only the
 * first occurs in any sample file we have.
 */
function ringsOf(geoPoly: FgmjObject, where: string): IgnitionRing[] {
  const polyset = geoPoly.polyset as FgmjObject | undefined;
  if (polyset) {
    const entries = asArray(polyset.polys);
    if (entries.length === 0) {
      throw new Error(`${where} has an empty polyset, so it describes no ring at all.`);
    }

    const rings = entries.map((entry, index) => {
      // Absent means Multipoint, the zero value — not Polygon. A perimeter made
      // of points is not a perimeter, and picking a part to keep would be
      // inventing geometry.
      const entryType = typeof entry.polyType === 'string' ? entry.polyType : '(absent)';
      if (entryType !== POLYSET_POLYGON) {
        throw new Error(
          `${where} has a polyset entry at index ${index} of type "${entryType}". ` +
            `Only ${POLYSET_POLYGON} entries form a perimeter; refusing to guess which ` +
            'part of a mixed set to burn.',
        );
      }
      return {
        points: pointsOf(
          (entry.polygon ?? {}) as FgmjObject,
          where,
          `polyset entry ${index}`,
        ),
        isHole: entry.isHole === true,
      };
    });

    if (rings.every((ring) => ring.isHole)) {
      throw new Error(
        `${where} is made only of holes, with no exterior ring for them to sit in.`,
      );
    }

    // Exterior rings first, so the first ring is always the outer boundary, as
    // GeoJSON requires.
    return [...rings.filter((r) => !r.isHole), ...rings.filter((r) => r.isHole)];
  }

  const single = geoPoly.polygon as FgmjObject | undefined;
  if (single) {
    return [{ points: pointsOf(single, where, 'its ring'), isHole: false }];
  }

  throw new Error(
    `${where} has neither a polygon nor a polyset, so it carries no geometry.`,
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

      // `polygon` here is the GeoPoly: the outer carries the units label, and
      // the shape sits in one of its two oneof branches. The label is NOT a
      // CRS; see the module header.
      const where = `Ignition "${ignitionName}" in scenario "${scenario.name}"`;
      const rings = ringsOf((geometry.polygon ?? {}) as FgmjObject, where);

      if (rings.every((ring) => ring.points.length === 0)) {
        throw new Error(
          `${where} has a ${polyType} geometry with no points. ` +
            'Refusing to import a fire with no location.',
        );
      }

      const latLon = isLatLon(rings);

      extracted.push({
        name: ignitionName,
        polyType,
        rings,
        startTime,
        coordinateSystem: latLon ? 'latLon' : 'projected',
        requiresCrs: !latLon,
        // crs is deliberately absent: only the operator can supply one.
        ...(latLon
          ? {
              latLonRings: rings.map((ring) => ({
                isHole: ring.isHole,
                points: ring.points.map((p) => ({ lon: p.x, lat: p.y })),
              })),
            }
          : {}),
      });
    }
  }

  return extracted;
}
