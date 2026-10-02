/**
 * Every drawn or imported feature becomes a requested ignition (refs #294).
 *
 * The submit path used to read `features[0]` and build one ignition, so
 * someone who drew two shapes silently lost one. The backend now merges more
 * than one through the same code the .fgmj import uses, so the job here is
 * simply to send them all — faithfully, and without inventing anything.
 */

import { describe, it, expect } from 'vitest';
import type { DrawnFeature } from '../../../Map/types/geometry';
import { toRequestedIgnitions } from '../toRequestedIgnitions';

const point = (lon: number, lat: number): DrawnFeature => ({
  type: 'Feature',
  properties: { mode: 'point' },
  geometry: { type: 'Point', coordinates: [lon, lat] },
});

const openRing: [number, number][] = [
  [-117, 60],
  [-116.9, 60],
  [-116.9, 60.1],
  [-117, 60.1],
];

const polygon = (ring: [number, number][]): DrawnFeature => ({
  type: 'Feature',
  properties: { mode: 'polygon' },
  geometry: { type: 'Polygon', coordinates: [ring] },
});

const line = (): DrawnFeature => ({
  type: 'Feature',
  properties: { mode: 'line' },
  geometry: { type: 'LineString', coordinates: [[-117, 60], [-116.9, 60]] },
});

describe('toRequestedIgnitions', () => {
  it('sends every feature, not just the first', () => {
    const requested = toRequestedIgnitions([polygon(openRing), point(-116, 59)]);
    expect(requested).toHaveLength(2);
    expect(requested[0].type).toBe('polygon');
    expect(requested[1].type).toBe('point');
  });

  it('closes an unclosed polygon ring', () => {
    // GeoJSON requires first === last, and TerraDraw does not always close it.
    const [requested] = toRequestedIgnitions([polygon(openRing)]);
    const rings = requested.coordinates as [number, number][][];
    expect(rings[0]).toHaveLength(openRing.length + 1);
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
  });

  it('leaves an already-closed ring alone rather than closing it twice', () => {
    const closed: [number, number][] = [...openRing, openRing[0]];
    const [requested] = toRequestedIgnitions([polygon(closed)]);
    const rings = requested.coordinates as [number, number][][];
    expect(rings[0]).toHaveLength(closed.length);
  });

  it('keeps a point’s coordinates as a single position', () => {
    const [requested] = toRequestedIgnitions([point(-117, 60)]);
    expect(requested.coordinates).toEqual([-117, 60]);
  });

  it('sends a line as linestring, for the rasterizer’s own line path', () => {
    const [requested] = toRequestedIgnitions([line()]);
    expect(requested.type).toBe('linestring');
    expect(requested.coordinates).toEqual([[-117, 60], [-116.9, 60]]);
  });

  it('returns nothing for no features, rather than a default ignition at 0,0', () => {
    // The old path initialised coordinates to [0, 0] and type 'point', so an
    // empty drawing would have started a fire in the Gulf of Guinea.
    expect(toRequestedIgnitions([])).toEqual([]);
  });

  it('preserves the order drawn, so the notices name the right ignition', () => {
    const requested = toRequestedIgnitions([point(-117, 60), polygon(openRing), line()]);
    expect(requested.map((r) => r.type)).toEqual(['point', 'polygon', 'linestring']);
  });
});
