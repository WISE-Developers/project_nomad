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

/**
 * #539. After #537 made the perimeter parser accept MultiPolygon, Franco uploaded a
 * real perimeter, watched it load, then hit Start Model and got
 * "No ignition was drawn or imported."
 *
 * This function's `default:` branch dropped every geometry it did not name, and its
 * comment said "Nothing else can be drawn or imported into SpatialData.features" —
 * true when it was written, false the moment the parser started admitting multi-part
 * geometries. The feature reached the map and died here, silently, so the user saw an
 * empty ignition list rather than an unsupported-type message.
 *
 * Every NWT perimeter is a MultiPolygon. A multi-part geometry expands into one
 * requested ignition PER PART — the backend already merges a list and names its
 * notices positionally — so nothing is invented and nothing is collapsed.
 */
describe('#539 multi-part geometries expand rather than vanish', () => {
  const ringA: [number, number][] = [[-117.7, 61.7], [-117.6, 61.7], [-117.6, 61.6], [-117.7, 61.7]];
  const ringB: [number, number][] = [[-116.7, 62.3], [-116.6, 62.3], [-116.6, 62.2], [-116.7, 62.3]];
  const hole: [number, number][] = [[-117.68, 61.68], [-117.65, 61.68], [-117.65, 61.65], [-117.68, 61.68]];

  const feat = (geometry: unknown): DrawnFeature =>
    ({ type: 'Feature', id: 'x', properties: {}, geometry } as unknown as DrawnFeature);

  it('expands a single-part MultiPolygon into one polygon ignition', () => {
    const out = toRequestedIgnitions([feat({ type: 'MultiPolygon', coordinates: [[ringA]] })]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('polygon');
    expect(out[0].coordinates).toEqual([ringA]);
  });

  it('expands a two-part MultiPolygon into two polygon ignitions, in order', () => {
    const out = toRequestedIgnitions([feat({ type: 'MultiPolygon', coordinates: [[ringA], [ringB]] })]);
    expect(out).toHaveLength(2);
    expect(out.every((i) => i.type === 'polygon')).toBe(true);
    expect(out[0].coordinates).toEqual([ringA]);
    expect(out[1].coordinates).toEqual([ringB]);
  });

  it('KEEPS the holes — an unburned island must not become burned', () => {
    const out = toRequestedIgnitions([feat({ type: 'MultiPolygon', coordinates: [[ringA, hole]] })]);
    expect(out).toHaveLength(1);
    expect(out[0].coordinates).toEqual([ringA, hole]);
  });

  it('expands MultiPoint and MultiLineString too', () => {
    const mp = toRequestedIgnitions([feat({ type: 'MultiPoint', coordinates: [[-117.7, 61.7], [-116.7, 62.3]] })]);
    expect(mp.map((i) => i.type)).toEqual(['point', 'point']);
    expect(mp[0].coordinates).toEqual([-117.7, 61.7]);

    const ml = toRequestedIgnitions([feat({ type: 'MultiLineString', coordinates: [[[-117.7, 61.7], [-117.6, 61.6]]] })]);
    expect(ml.map((i) => i.type)).toEqual(['linestring']);
  });

  it('closes an unclosed MultiPolygon ring, as it does for Polygon', () => {
    const open: [number, number][] = [[-117.7, 61.7], [-117.6, 61.7], [-117.6, 61.6]];
    const out = toRequestedIgnitions([feat({ type: 'MultiPolygon', coordinates: [[open]] })]);
    expect(out[0].coordinates).toEqual([[...open, open[0]]]);
  });

  it('mixes multi-part and single-part features without losing either', () => {
    const out = toRequestedIgnitions([
      feat({ type: 'MultiPolygon', coordinates: [[ringA], [ringB]] }),
      feat({ type: 'Point', coordinates: [-115.0, 60.0] }),
    ]);
    expect(out.map((i) => i.type)).toEqual(['polygon', 'polygon', 'point']);
  });

  it('an empty MultiPolygon still yields nothing, inventing no geometry', () => {
    expect(toRequestedIgnitions([feat({ type: 'MultiPolygon', coordinates: [] })])).toHaveLength(0);
  });
});
