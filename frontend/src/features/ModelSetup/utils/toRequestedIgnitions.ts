/**
 * Every drawn or imported feature as a requested ignition (refs #294).
 *
 * The submit path used to read `features[0]` and build one ignition, so
 * someone who drew two shapes silently lost one. The backend now merges more
 * than one through the same code the .fgmj import uses — a point becomes a
 * nominal one-pixel circle, a line a nominal corridor, and each gets a notice
 * — so the job here is only to send them all faithfully.
 *
 * It invents nothing. An empty drawing returns an empty list rather than the
 * old default of a point at [0, 0], which would have started a fire in the
 * Gulf of Guinea.
 */

import type { DrawnFeature } from '../../Map/types/geometry';

export interface RequestedIgnition {
  type: 'point' | 'polygon' | 'linestring';
  coordinates: [number, number] | [number, number][] | [number, number][][];
}

/** GeoJSON polygons require first === last; TerraDraw does not always close. */
function closed(ring: [number, number][]): [number, number][] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return ring;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

export function toRequestedIgnitions(features: DrawnFeature[]): RequestedIgnition[] {
  const requested: RequestedIgnition[] = [];

  // Order is preserved: the backend names its notices positionally
  // ("ignition 1", "ignition 2"), so reordering here would misattribute them.
  for (const feature of features) {
    const { geometry } = feature;
    switch (geometry.type) {
      case 'Point':
        requested.push({
          type: 'point',
          coordinates: geometry.coordinates as [number, number],
        });
        break;
      case 'Polygon':
        requested.push({
          type: 'polygon',
          coordinates: (geometry.coordinates as [number, number][][]).map(closed),
        });
        break;
      case 'LineString':
        requested.push({
          type: 'linestring',
          coordinates: geometry.coordinates as [number, number][],
        });
        break;
      default:
        // Nothing else can be drawn or imported into SpatialData.features, and
        // guessing a type is how a fire ends up the wrong shape. The backend
        // refuses unknown types by name.
        break;
    }
  }

  return requested;
}
