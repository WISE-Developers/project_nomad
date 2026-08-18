/**
 * Ignition latitude resolution — issue #356.
 *
 * CFFDRS needs a latitude for its day-length term, and the backend treats it as
 * mandatory on the raw_weather path (WeatherService.ts:106). App.tsx read it
 * from geometry.bounds, which is optional, so a polygon ignition drawn without
 * bounds sent `latitude: undefined` and failed a network hop later with a
 * message written for a developer.
 *
 * Resolution order preserves what already worked, so no existing model changes
 * its result:
 *
 *   1. a Point ignition's own latitude
 *   2. bounds[1] — minLat — where bounds is populated
 *   3. the minimum latitude across the drawn coordinates, which is what bounds
 *      would have held
 *
 * If none of those yields a number it throws, rather than letting an undefined
 * required value cross the network.
 */

import type { SpatialData } from '../types/index.js';

/** Every [lng, lat] pair in a drawn feature, whatever its geometry type. */
function coordinatesOf(feature: SpatialData['features'][number]): number[][] {
  const { geometry } = feature;

  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'LineString') return geometry.coordinates;
  if (geometry.type === 'Polygon') return geometry.coordinates.flat();

  return [];
}

export function resolveIgnitionLatitude(geometry: SpatialData): number {
  const features = geometry.features ?? [];

  // 1. A point ignition names its own latitude. Unchanged from before.
  const first = features[0];
  if (first?.geometry?.type === 'Point') {
    const latitude = (first.geometry.coordinates as [number, number])[1];
    if (Number.isFinite(latitude)) return latitude;
  }

  // 2. bounds is [minLng, minLat, maxLng, maxLat]. Unchanged from before —
  //    changing it would silently move the day-length term for every existing
  //    polygon model.
  const bounded = geometry.bounds?.[1];
  if (Number.isFinite(bounded)) return bounded as number;

  // 3. Derive what bounds would have held. The coordinates are always there;
  //    bounds is not.
  const latitudes = features
    .flatMap(coordinatesOf)
    .map((position) => position[1])
    .filter((latitude): latitude is number => Number.isFinite(latitude));

  if (latitudes.length > 0) return Math.min(...latitudes);

  throw new Error(
    'Ignition latitude could not be determined — draw or import an ignition before starting the model',
  );
}
