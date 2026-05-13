import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';

export type PerimeterFeatureCollection = FeatureCollection<Polygon | MultiPolygon>;

export function parsePerimeterGeoJSON(input: string): PerimeterFeatureCollection {
  const parsed = JSON.parse(input) as PerimeterFeatureCollection;
  return parsed;
}
