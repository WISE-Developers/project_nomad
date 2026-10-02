/**
 * Turn an imported ignition into geometry FireSTARR can burn (refs #294).
 *
 * Produces the same SpatialGeometry domain object POST /models builds from a
 * request body, so an imported fire burns exactly as a normally-created one
 * does. Nothing bespoke.
 *
 * HOLES ARE PRESERVED. The schema flags them — Math.XYPolySet.PolySetEntry
 * declares `isHole: bool` — so an unburned island inside a perimeter is stated
 * rather than inferred from winding order. Dropping one burns ground the
 * original left standing: a larger fire than the file describes, from a run
 * that completes and looks entirely plausible.
 *
 * Shape comes from the schema's own enum,
 * CwfgmIgnition.IgnitionPoint.IgnitionShape:
 *
 *   UNKNOWN 0   POINT 1   LINE 2   POLYGON_OUT 3   POLYGON_IN 4
 *
 * POLYGON_IN burns INWARD from its perimeter. It is geometrically the same
 * polygon as POLYGON_OUT, so mapping both to Polygon would lose the
 * distinction silently. It is mapped and RECORDED as a divergence instead —
 * FireSTARR grows a fire outward, so an inward-burning ignition does not
 * reproduce as written.
 *
 * UNKNOWN is zero, so proto3 omits it: an absent polyType is a shape the file
 * never stated, and a fire whose shape we are guessing is not an import.
 */

import {
  GeometryType,
  SpatialGeometry,
  type Position,
} from '../../domain/entities/SpatialGeometry.js';
import type { ScenarioImportPlan } from './planFgmjImport.js';

export interface IgnitionGeometry {
  /** The name the file gave this ignition. */
  name: string;
  geometry: SpatialGeometry;
  /**
   * Present when the imported fire will not behave as the original did —
   * currently only POLYGON_IN, whose inward growth FireSTARR does not model.
   */
  divergence?: string;
}

interface ShapeRule {
  type: GeometryType;
  /** Whether holes are meaningful for this shape. */
  allowsHoles: boolean;
  divergence?: (name: string) => string;
}

const SHAPES: Record<string, ShapeRule> = {
  POINT: { type: GeometryType.Point, allowsHoles: false },
  LINE: { type: GeometryType.LineString, allowsHoles: false },
  POLYGON_OUT: { type: GeometryType.Polygon, allowsHoles: true },
  POLYGON_IN: {
    type: GeometryType.Polygon,
    allowsHoles: true,
    divergence: (name) =>
      `Ignition "${name}" is POLYGON_IN — the original burned INWARD from this ` +
      'perimeter. FireSTARR grows a fire outward from its ignition, so the imported ' +
      'run will spread the opposite way. The geometry is preserved; the behaviour is ' +
      'not the same.',
  },
};

/** GeoJSON rings must close. The file's rings generally do not. */
function closed(points: Position[]): Position[] {
  if (points.length === 0) return points;
  const [first] = points;
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, [first[0], first[1]]];
}

export function toIgnitionGeometries(plan: ScenarioImportPlan): IgnitionGeometry[] {
  return plan.ignitions.map((ignition) => {
    if (!ignition.latLonRings) {
      throw new Error(
        `Ignition "${ignition.name}" in scenario "${plan.scenarioName}" is still in ` +
          'projected coordinates. Resolve the CRS before building its geometry — ' +
          'FireSTARR takes lat/lon.',
      );
    }

    const rule = SHAPES[ignition.polyType];
    if (!rule) {
      const known = Object.keys(SHAPES).join(', ');
      throw new Error(
        `Ignition "${ignition.name}" has shape "${ignition.polyType}", which this ` +
          `importer cannot turn into geometry. Known shapes: ${known}. ` +
          '(UNKNOWN is the schema’s zero value, so an absent shape arrives as that ' +
          'and is equally unusable.)',
      );
    }

    const rings = ignition.latLonRings.map((r) => ({
      isHole: r.isHole,
      points: r.points.map((p) => [p.lon, p.lat] as Position),
    }));

    const holes = rings.filter((r) => r.isHole);
    if (holes.length > 0 && !rule.allowsHoles) {
      throw new Error(
        `Ignition "${ignition.name}" is a ${ignition.polyType} but carries ` +
          `${holes.length} hole(s). Holes only mean something inside a polygon; ` +
          'refusing rather than discarding them.',
      );
    }

    const exterior = rings.find((r) => !r.isHole);
    if (!exterior || exterior.points.length === 0) {
      throw new Error(
        `Ignition "${ignition.name}" has no exterior ring with any points.`,
      );
    }

    let geometry: SpatialGeometry;
    switch (rule.type) {
      case GeometryType.Point:
        geometry = new SpatialGeometry({
          type: GeometryType.Point,
          coordinates: exterior.points[0],
        });
        break;
      case GeometryType.LineString:
        geometry = new SpatialGeometry({
          type: GeometryType.LineString,
          coordinates: exterior.points,
        });
        break;
      default:
        geometry = new SpatialGeometry({
          type: GeometryType.Polygon,
          // Exterior first, then holes — the order GeoJSON requires, and the
          // order extractIgnitions already put them in.
          coordinates: [
            closed(exterior.points),
            ...holes.map((hole) => closed(hole.points)),
          ],
        });
    }

    return {
      name: ignition.name,
      geometry,
      ...(rule.divergence ? { divergence: rule.divergence(ignition.name) } : {}),
    };
  });
}
