/**
 * Turn the ignition(s) a client asked for into one geometry the engine can
 * burn (refs #294).
 *
 * The run request used to carry exactly one ignition, and the frontend sent
 * `features[0]` — so someone who drew two shapes silently lost one. Now every
 * feature travels and more than one is merged here, through the same
 * mergeIgnitions the .fgmj import uses. One implementation, so a hand-drawn
 * merge and an imported merge cannot behave differently.
 *
 * A single ignition is passed through untouched: a lone polygon is a Polygon,
 * a lone line stays a LineString and is burned by the rasterizer's own line
 * path. Nothing is wrapped in a MultiPolygon it does not need.
 */

import { ValidationError } from '../../domain/errors/index.js';
import {
  GeometryType,
  SpatialGeometry,
  type Coordinates,
} from '../../domain/entities/index.js';
import { mergeIgnitions, type NamedIgnition } from './mergeIgnitions.js';

/** One ignition as it arrives on the wire. */
export interface RequestedIgnition {
  type: string;
  coordinates: unknown;
}

export interface ResolvedIgnitions {
  readonly geometry: SpatialGeometry;
  /**
   * What was done to the requested ignitions — empty for a single one.
   *
   * These must reach the operator. A point quietly turned into a 100 m circle
   * is the kind of silence this whole issue has been removing.
   */
  readonly notices: string[];
}

/**
 * The wire's lowercase names, mapped exactly.
 *
 * A lookup rather than a chain of ternaries. The route used to build the type
 * with `=== 'point' ? Point : === 'linestring' ? LineString : Polygon`, which
 * has no else branch — so 'multipolygon', 'Point' with a capital P, or any
 * typo became Polygon and failed later somewhere less obvious.
 */
const WIRE_TYPES: Record<string, GeometryType> = {
  point: GeometryType.Point,
  polygon: GeometryType.Polygon,
  linestring: GeometryType.LineString,
};

function geometryOf(requested: RequestedIgnition, position: number): SpatialGeometry {
  const type = WIRE_TYPES[requested.type];
  if (!type) {
    throw ValidationError.forField(
      `ignitions[${position}].type`,
      `"${requested.type}" is not an ignition geometry type. ` +
        `Expected one of: ${Object.keys(WIRE_TYPES).join(', ')}. ` +
        'Refusing rather than assuming which was meant.',
    );
  }
  // SpatialGeometry validates the coordinates against the type and throws with
  // the ring and position named, so nothing is re-checked here.
  return new SpatialGeometry({ type, coordinates: requested.coordinates as Coordinates });
}

export function resolveRequestedIgnitions(
  requested: RequestedIgnition[],
): ResolvedIgnitions {
  if (requested.length === 0) {
    throw ValidationError.forField(
      'ignitions',
      'requires at least one ignition — FireSTARR needs somewhere to start the fire',
    );
  }

  const geometries = requested.map(geometryOf);

  if (geometries.length === 1) {
    return { geometry: geometries[0], notices: [] };
  }

  // Positional names: a drawn shape has no name of its own, and a notice that
  // cannot say WHICH ignition it is about is barely a notice.
  const named: NamedIgnition[] = geometries.map((geometry, i) => ({
    name: `ignition ${i + 1}`,
    geometry,
  }));

  return mergeIgnitions(named);
}
