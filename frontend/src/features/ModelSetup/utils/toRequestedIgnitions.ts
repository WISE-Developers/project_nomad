/**
 * Every drawn or imported feature as a requested ignition (refs #294, #539).
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

      // MULTI-PART GEOMETRIES EXPAND, ONE IGNITION PER PART (#539).
      //
      // Every NWT VIIRS and GPS perimeter is a MultiPolygon — a fire with an
      // unburned island, or several disjoint lobes, cannot be a single Polygon.
      // Before #537 the parser never admitted one, so the `default` below dropped
      // them and its comment was true. After #537 they reach the map, and dropping
      // them here produced an empty ignition list and "No ignition was drawn or
      // imported" on a perimeter the user had just watched load.
      //
      // Expanding is faithful rather than clever: the backend already accepts a
      // list and merges it, and each part keeps its own rings, so a hole stays a
      // hole. Collapsing the parts into one ring would burn the island.
      case 'MultiPolygon':
        for (const polygon of geometry.coordinates as [number, number][][][]) {
          requested.push({ type: 'polygon', coordinates: polygon.map(closed) });
        }
        break;
      case 'MultiPoint':
        for (const point of geometry.coordinates as [number, number][]) {
          requested.push({ type: 'point', coordinates: point });
        }
        break;
      case 'MultiLineString':
        for (const line of geometry.coordinates as [number, number][][]) {
          requested.push({ type: 'linestring', coordinates: line });
        }
        break;

      default:
        // Guessing a type is how a fire ends up the wrong shape, so anything
        // still unnamed here is left for the backend to refuse by name.
        // NOTE: this branch is silent, which is only safe while every type the
        // parser admits is handled above. `parsePerimeterGeoJSON`'s
        // SUPPORTED_GEOMETRY_TYPES is the list that must stay in step — #537 and
        // #539 are the same defect, one layer apart, and both were invisible
        // because a drop reported success.
        break;
    }
  }

  return requested;
}
