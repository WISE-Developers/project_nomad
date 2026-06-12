/**
 * Tests for RasterLegend component
 *
 * Verifies the burn probability legend renders correctly, shows when raster
 * layers are visible, and hides when no raster layers are active.
 *
 * @module features/Map/components/__tests__
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RasterLegend, parseRampStops } from './RasterLegend.js';
import { ARRIVAL_RAMP_PRESETS } from '../utils/arrivalTimeSymbolization.js';

// =============================================================================
// Mock LayerContext
// =============================================================================

const mockUseLayers = vi.fn();

vi.mock('../context/LayerContext.js', () => ({
  useLayers: () => mockUseLayers(),
}));

// =============================================================================
// Test Helpers
// =============================================================================

function makeRasterLayer(id: string, visible = true) {
  return {
    id,
    name: `Raster ${id}`,
    type: 'raster' as const,
    visible,
    opacity: 1,
    zIndex: 0,
    url: `http://example.com/tiles/${id}/{z}/{x}/{y}.png`,
  };
}

function makeArrivalLayer(
  id: string,
  timestep: 'daily' | 'hourly' = 'hourly',
  breaksPerDay?: number,
) {
  return {
    ...makeRasterLayer(id, true),
    legendType: 'arrival' as const,
    arrivalMeta: {
      offsetDay: 170,
      startJulian: 170,
      endJulian: 173,
      startDate: '2026-06-19T00:00:00Z',
      timestep,
      breaksPerDay,
      highlightBuckets: [] as number[],
    },
  };
}

function makeGeoJSONLayer(id: string) {
  return {
    id,
    name: `GeoJSON ${id}`,
    type: 'geojson' as const,
    visible: true,
    opacity: 1,
    zIndex: 0,
    data: { type: 'FeatureCollection' as const, features: [] },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('RasterLegend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('visibility', () => {
    it('renders when at least one visible raster layer exists', () => {
      mockUseLayers.mockReturnValue({
        state: { layers: [makeRasterLayer('prob-1', true)], groups: [], selectedLayerId: null },
      });

      render(<RasterLegend />);
      expect(screen.getByText(/burn probability/i)).toBeInTheDocument();
    });

    it('does not render when no raster layers exist', () => {
      mockUseLayers.mockReturnValue({
        state: { layers: [makeGeoJSONLayer('geojson-1')], groups: [], selectedLayerId: null },
      });

      const { container } = render(<RasterLegend />);
      expect(container.firstChild).toBeNull();
    });

    it('does not render when all raster layers are hidden', () => {
      mockUseLayers.mockReturnValue({
        state: {
          layers: [makeRasterLayer('prob-1', false), makeRasterLayer('prob-2', false)],
          groups: [],
          selectedLayerId: null,
        },
      });

      const { container } = render(<RasterLegend />);
      expect(container.firstChild).toBeNull();
    });

    it('renders when at least one raster layer is visible even if others are hidden', () => {
      mockUseLayers.mockReturnValue({
        state: {
          layers: [makeRasterLayer('prob-1', false), makeRasterLayer('prob-2', true)],
          groups: [],
          selectedLayerId: null,
        },
      });

      render(<RasterLegend />);
      expect(screen.getByText(/burn probability/i)).toBeInTheDocument();
    });

    it('does not render when layer list is empty', () => {
      mockUseLayers.mockReturnValue({
        state: { layers: [], groups: [], selectedLayerId: null },
      });

      const { container } = render(<RasterLegend />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('legend items', () => {
    beforeEach(() => {
      mockUseLayers.mockReturnValue({
        state: { layers: [makeRasterLayer('prob-1', true)], groups: [], selectedLayerId: null },
      });
    });

    // #283 Unit 2: legend is now sourced from the vendored FireSTARR SLD via
    // symbology/palettes — percent labels high->low, blue low (#00b1f2) ->
    // red high (#e6151f). The low class now starts at 0% (fixes #270 trim);
    // the old spurious green `1-10%` class is gone.
    it('shows all 10 probability labels', () => {
      render(<RasterLegend />);
      expect(screen.getByText('>90%')).toBeInTheDocument();
      expect(screen.getByText('80-90%')).toBeInTheDocument();
      expect(screen.getByText('70-80%')).toBeInTheDocument();
      expect(screen.getByText('60-70%')).toBeInTheDocument();
      expect(screen.getByText('50-60%')).toBeInTheDocument();
      expect(screen.getByText('40-50%')).toBeInTheDocument();
      expect(screen.getByText('30-40%')).toBeInTheDocument();
      expect(screen.getByText('20-30%')).toBeInTheDocument();
      expect(screen.getByText('10-20%')).toBeInTheDocument();
      expect(screen.getByText('0-10%')).toBeInTheDocument();
    });

    it('renders 10 color swatches', () => {
      const { container } = render(<RasterLegend />);
      // Each swatch has a data-testid
      const swatches = container.querySelectorAll('[data-testid="legend-swatch"]');
      expect(swatches).toHaveLength(10);
    });

    it('renders the red high swatch for the >90% entry', () => {
      const { container } = render(<RasterLegend />);
      const swatches = container.querySelectorAll('[data-testid="legend-swatch"]');
      // First swatch corresponds to >90% (SLD high class #e6151f)
      expect(swatches[0]).toHaveStyle({ backgroundColor: '#e6151f' });
    });

    it('renders the blue low swatch for the 0-10% entry (SLD low class, #270)', () => {
      const { container } = render(<RasterLegend />);
      const swatches = container.querySelectorAll('[data-testid="legend-swatch"]');
      // Last swatch corresponds to 0-10% (SLD low class #00b1f2 — no longer green)
      expect(swatches[9]).toHaveStyle({ backgroundColor: '#00b1f2' });
    });
  });

  describe('arrival breaks control (#271 Unit 8)', () => {
    it('shows the breaks options in hourly mode', () => {
      mockUseLayers.mockReturnValue({
        state: { layers: [makeArrivalLayer('a', 'hourly')], groups: [], selectedLayerId: null },
        updateLayer: vi.fn(),
      });
      render(<RasterLegend />);
      expect(screen.getByTestId('arrival-breaks-24')).toBeInTheDocument();
      expect(screen.getByTestId('arrival-breaks-8')).toBeInTheDocument();
      expect(screen.getByTestId('arrival-breaks-4')).toBeInTheDocument();
    });

    it('hides the breaks options in daily mode', () => {
      mockUseLayers.mockReturnValue({
        state: { layers: [makeArrivalLayer('a', 'daily')], groups: [], selectedLayerId: null },
        updateLayer: vi.fn(),
      });
      render(<RasterLegend />);
      expect(screen.queryByTestId('arrival-breaks-24')).toBeNull();
    });

    it('clicking a breaks option updates the layer breaksPerDay', () => {
      const updateLayer = vi.fn();
      mockUseLayers.mockReturnValue({
        state: {
          layers: [makeArrivalLayer('a', 'hourly', 24)],
          groups: [],
          selectedLayerId: null,
        },
        updateLayer,
      });
      render(<RasterLegend />);
      fireEvent.click(screen.getByTestId('arrival-breaks-4'));
      expect(updateLayer).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({
          arrivalMeta: expect.objectContaining({ breaksPerDay: 4 }),
        }),
      );
    });
  });

  describe('arrival ramp picker (#271 Unit 9)', () => {
    it('renders the ramp select with viridis as the default', () => {
      mockUseLayers.mockReturnValue({
        state: { layers: [makeArrivalLayer('a', 'daily')], groups: [], selectedLayerId: null },
        updateLayer: vi.fn(),
      });
      render(<RasterLegend />);
      const select = screen.getByTestId('arrival-ramp-select') as HTMLSelectElement;
      expect(select.value).toBe('viridis');
    });

    it('changing the ramp updates the layer ramp', () => {
      const updateLayer = vi.fn();
      mockUseLayers.mockReturnValue({
        state: { layers: [makeArrivalLayer('a', 'daily')], groups: [], selectedLayerId: null },
        updateLayer,
      });
      render(<RasterLegend />);
      fireEvent.change(screen.getByTestId('arrival-ramp-select'), { target: { value: 'YlGnBu' } });
      expect(updateLayer).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({ arrivalMeta: expect.objectContaining({ ramp: 'YlGnBu' }) }),
      );
    });
  });

  describe('arrival day recolour (#271 Unit 7)', () => {
    it('renders daily swatches as colour inputs and recolours a day', () => {
      const updateLayer = vi.fn();
      mockUseLayers.mockReturnValue({
        state: { layers: [makeArrivalLayer('a', 'daily')], groups: [], selectedLayerId: null },
        updateLayer,
      });
      render(<RasterLegend />);
      const swatches = screen.getAllByTestId('legend-swatch');
      expect((swatches[0] as HTMLInputElement).type).toBe('color');
      fireEvent.change(swatches[0], { target: { value: '#ff8800' } });
      expect(updateLayer).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({
          arrivalMeta: expect.objectContaining({
            dayColorOverrides: expect.objectContaining({ 0: '#ff8800' }),
          }),
        }),
      );
    });
  });

  describe('arrival click-to-highlight (#272 Unit 6)', () => {
    it('clicking a legend band toggles its highlight bucket', () => {
      const updateLayer = vi.fn();
      mockUseLayers.mockReturnValue({
        state: { layers: [makeArrivalLayer('a', 'daily')], groups: [], selectedLayerId: null },
        updateLayer,
      });
      render(<RasterLegend />);
      const bands = screen.getAllByTestId('legend-highlight');
      fireEvent.click(bands[1]); // day 1 (bucket index 1)
      expect(updateLayer).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({
          arrivalMeta: expect.objectContaining({ highlightBuckets: [1] }),
        }),
      );
    });

    it('clicking an already-highlighted band removes it', () => {
      const updateLayer = vi.fn();
      const layer = makeArrivalLayer('a', 'daily');
      layer.arrivalMeta.highlightBuckets = [1];
      mockUseLayers.mockReturnValue({
        state: { layers: [layer], groups: [], selectedLayerId: null },
        updateLayer,
      });
      render(<RasterLegend />);
      fireEvent.click(screen.getAllByTestId('legend-highlight')[1]);
      expect(updateLayer).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({
          arrivalMeta: expect.objectContaining({ highlightBuckets: [] }),
        }),
      );
    });

    // Bucket indices differ between binnings, so a highlight must reset when the
    // timestep or breaks change — otherwise a stale index dims every band.
    it('clears the highlight when the timestep changes', () => {
      const updateLayer = vi.fn();
      const layer = makeArrivalLayer('a', 'hourly');
      layer.arrivalMeta.highlightBuckets = [6];
      mockUseLayers.mockReturnValue({
        state: { layers: [layer], groups: [], selectedLayerId: null },
        updateLayer,
      });
      render(<RasterLegend />);
      fireEvent.click(screen.getByTestId('arrival-timestep-daily'));
      expect(updateLayer).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({
          arrivalMeta: expect.objectContaining({ timestep: 'daily', highlightBuckets: [] }),
        }),
      );
    });

    it('clears the highlight when the breaks-per-day changes', () => {
      const updateLayer = vi.fn();
      const layer = makeArrivalLayer('a', 'hourly', 24);
      layer.arrivalMeta.highlightBuckets = [30];
      mockUseLayers.mockReturnValue({
        state: { layers: [layer], groups: [], selectedLayerId: null },
        updateLayer,
      });
      render(<RasterLegend />);
      fireEvent.click(screen.getByTestId('arrival-breaks-4'));
      expect(updateLayer).toHaveBeenCalledWith(
        'a',
        expect.objectContaining({
          arrivalMeta: expect.objectContaining({ breaksPerDay: 4, highlightBuckets: [] }),
        }),
      );
    });
  });

  describe('parseRampStops (#271 Unit 9)', () => {
    it('parses whitespace/comma-separated hex stops', () => {
      expect(parseRampStops('#000000, #ffffff')).toEqual(['#000000', '#ffffff']);
      expect(parseRampStops('000000\n123456\nabcdef')).toEqual(['#000000', '#123456', '#abcdef']);
    });
    it('parses a JSON array of hex stops', () => {
      expect(parseRampStops('["#000000","#FFFFFF"]')).toEqual(['#000000', '#ffffff']);
    });
    it('throws (fail-fast) on malformed colours', () => {
      expect(() => parseRampStops('#000000 nope')).toThrow(/invalid colour/i);
    });
    it('throws when fewer than two stops', () => {
      expect(() => parseRampStops('#000000')).toThrow(/at least two/i);
    });
  });

  describe('accessibility (#283 Unit 10)', () => {
    it('the legend region has an accessible name', () => {
      mockUseLayers.mockReturnValue({
        state: { layers: [makeRasterLayer('prob-1', true)], groups: [], selectedLayerId: null },
      });
      render(<RasterLegend />);
      expect(screen.getByRole('complementary', { name: /map legend/i })).toBeInTheDocument();
    });

    it('each legend block exposes a programmatic heading', () => {
      mockUseLayers.mockReturnValue({
        state: {
          layers: [makeRasterLayer('prob-1', true), makeArrivalLayer('a', 'daily')],
          groups: [],
          selectedLayerId: null,
        },
        updateLayer: vi.fn(),
      });
      render(<RasterLegend />);
      expect(screen.getByRole('heading', { name: /burn probability/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /fire arrival time/i })).toBeInTheDocument();
    });

    it('interactive arrival controls have accessible names', () => {
      mockUseLayers.mockReturnValue({
        state: { layers: [makeArrivalLayer('a', 'hourly')], groups: [], selectedLayerId: null },
        updateLayer: vi.fn(),
      });
      render(<RasterLegend />);
      expect(screen.getByLabelText(/arrival colour ramp/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/upload custom colour ramp/i)).toBeInTheDocument();
      expect(screen.getByRole('group', { name: /breaks per day/i })).toBeInTheDocument();
    });

    it('exposes only the colour-blind-safe (no-red) ramp presets', () => {
      expect(ARRIVAL_RAMP_PRESETS).toEqual(['viridis', 'YlGnBu', 'BuGn', 'PuBu']);
    });
  });

  describe('positioning and styling', () => {
    beforeEach(() => {
      mockUseLayers.mockReturnValue({
        state: { layers: [makeRasterLayer('prob-1', true)], groups: [], selectedLayerId: null },
      });
    });

    it('renders the legend container with a title', () => {
      render(<RasterLegend />);
      expect(screen.getByRole('complementary')).toBeInTheDocument();
    });

    it('has position absolute or fixed for overlay placement', () => {
      const { container } = render(<RasterLegend />);
      const legend = container.firstChild as HTMLElement;
      const style = legend.style;
      expect(['absolute', 'fixed']).toContain(style.position);
    });
  });
});
