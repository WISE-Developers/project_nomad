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
import { render, screen } from '@testing-library/react';
import { RasterLegend } from './RasterLegend.js';

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
