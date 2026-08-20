/**
 * Ignition latitude resolution — issue #356.
 *
 * CFFDRS needs a latitude for its day-length term. App.tsx read it from
 * geometry.bounds, which is optional, so a polygon ignition drawn without
 * bounds sent latitude: undefined and failed a network hop later with a
 * developer-facing message.
 *
 * Behaviour is deliberately preserved where it already worked: a Point still
 * yields its own latitude, and bounds still wins where present, so no existing
 * model changes its result. Only the undefined case is new.
 */

import { describe, it, expect } from 'vitest';
import { resolveIgnitionLatitude } from '../ignitionLatitude.js';
import type { SpatialData } from '../../types/index.js';

function spatial(overrides: Partial<SpatialData>): SpatialData {
  return {
    type: 'polygon',
    features: [],
    inputMethod: 'draw',
    ...overrides,
  } as SpatialData;
}

function point(lng: number, lat: number) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Point' as const, coordinates: [lng, lat] },
  };
}

function polygon(ring: Array<[number, number]>) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [ring] },
  };
}

function line(coords: Array<[number, number]>) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: coords },
  };
}

describe('resolveIgnitionLatitude', () => {
  it('uses the point ignition latitude', () => {
    const data = spatial({ type: 'point', features: [point(-114.07, 51.05)] as SpatialData['features'] });
    expect(resolveIgnitionLatitude(data)).toBe(51.05);
  });

  it('prefers the point over bounds — unchanged from before', () => {
    const data = spatial({
      type: 'point',
      features: [point(-114.07, 51.05)] as SpatialData['features'],
      bounds: [-120, 44.4, -110, 60],
    });
    expect(resolveIgnitionLatitude(data)).toBe(51.05);
  });

  it('uses bounds minLat for a polygon when bounds are present — unchanged from before', () => {
    // Preserving this exactly matters: changing it would silently move the
    // day-length term for every existing polygon model.
    const data = spatial({
      features: [polygon([[-114, 60], [-113, 61], [-114, 60]])] as SpatialData['features'],
      bounds: [-120, 44.4, -110, 62],
    });
    expect(resolveIgnitionLatitude(data)).toBe(44.4);
  });

  describe('when bounds were never populated', () => {
    it('derives the same minLat from the polygon coordinates', () => {
      const data = spatial({
        features: [polygon([[-114, 60.5], [-113, 61.2], [-113.5, 59.8], [-114, 60.5]])] as SpatialData['features'],
      });
      expect(resolveIgnitionLatitude(data)).toBe(59.8);
    });

    it('derives minLat from a linestring', () => {
      const data = spatial({
        type: 'line',
        features: [line([[-114, 62.1], [-113, 60.4]])] as SpatialData['features'],
      });
      expect(resolveIgnitionLatitude(data)).toBe(60.4);
    });

    it('considers every feature, not just the first', () => {
      const data = spatial({
        features: [
          polygon([[-114, 62], [-113, 63], [-114, 62]]),
          polygon([[-110, 55.25], [-109, 56], [-110, 55.25]]),
        ] as SpatialData['features'],
      });
      expect(resolveIgnitionLatitude(data)).toBe(55.25);
    });
  });

  describe('fail-fast', () => {
    it('throws when there is no geometry at all', () => {
      expect(() => resolveIgnitionLatitude(spatial({}))).toThrow(/latitude/i);
    });

    it('names the problem in words a duty officer can act on', () => {
      // The old failure surfaced as "Latitude required for CFFDRS calculation"
      // from the backend, after the request had already been sent.
      expect(() => resolveIgnitionLatitude(spatial({}))).toThrow(/ignition/i);
    });

    it('throws rather than returning undefined for an empty polygon ring', () => {
      const data = spatial({ features: [polygon([])] as SpatialData['features'] });
      expect(() => resolveIgnitionLatitude(data)).toThrow(/latitude/i);
    });
  });
});
