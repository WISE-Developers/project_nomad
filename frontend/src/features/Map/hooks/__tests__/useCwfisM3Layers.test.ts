/**
 * Tests for useCwfisM3Layers hook (Nomad #299)
 *
 * Verifies the CWFIS M3 public WMS layer configuration:
 * - Exposes two layers: M3 hotspots (temporal) and M3 perimeters (polygons)
 * - Builds correct CWFIS public WMS GetMap URLs (no auth key — public service)
 * - Applies a TIME param for temporal (hotspot) layers, omits it otherwise
 * - Provides a current-season TIME range for hotspots
 *
 * Data source: https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows (public, no auth)
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useCwfisM3Layers,
  buildCwfisWmsUrl,
  currentSeasonTime,
} from '../useCwfisM3Layers.js';

const WMS_BASE = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows';

describe('useCwfisM3Layers', () => {
  it('exposes the two M3 layers: hotspots (temporal) and perimeters (polygons)', () => {
    const { result } = renderHook(() => useCwfisM3Layers());

    expect(result.current.available).toBe(true);
    expect(result.current.layers).toHaveLength(2);

    const byId = Object.fromEntries(result.current.layers.map((l) => [l.id, l]));

    expect(byId['cwfis-m3-hotspots']).toBeDefined();
    expect(byId['cwfis-m3-hotspots'].layerName).toBe('public:hotspots');
    expect(byId['cwfis-m3-hotspots'].temporal).toBe(true);

    expect(byId['cwfis-m3-perimeters']).toBeDefined();
    expect(byId['cwfis-m3-perimeters'].layerName).toBe('public:m3polygons');
    expect(byId['cwfis-m3-perimeters'].temporal).toBe(false);
  });

  it('builds a valid CWFIS public WMS GetMap URL with a bbox placeholder and no auth key', () => {
    const url = buildCwfisWmsUrl('public:m3polygons');

    expect(url).toContain(WMS_BASE);
    expect(url).toContain('{bbox-epsg-3857}');
    expect(url).toContain('GetMap');
    expect(url).toContain('public:m3polygons');
    // Public service — must NOT carry an authkey param
    expect(url).not.toContain('authkey');
  });

  it('includes a TIME param when a time range is supplied (hotspots)', () => {
    const url = buildCwfisWmsUrl('public:hotspots', { time: '2026-01-01/2026-07-22' });

    expect(url).toContain('TIME=');
    expect(url).toContain('2026-01-01');
    expect(url).toContain('2026-07-22');
  });

  it('omits the TIME param when no time is supplied (perimeters)', () => {
    const url = buildCwfisWmsUrl('public:m3polygons');
    expect(url).not.toContain('TIME=');
  });

  it('currentSeasonTime returns a season range from the year start to a later date', () => {
    const range = currentSeasonTime(new Date('2026-07-22T00:00:00Z'));
    expect(range).toBe('2026-01-01/2026-07-22');
  });

  it('the hook builds hotspot URLs stamped with the current season range', () => {
    const { result } = renderHook(() => useCwfisM3Layers());
    const url = result.current.buildWmsUrl('public:hotspots', {
      time: currentSeasonTime(new Date('2026-07-22T00:00:00Z')),
    });
    expect(url).toContain('TIME=');
    expect(url).toContain('2026-01-01');
  });
});
