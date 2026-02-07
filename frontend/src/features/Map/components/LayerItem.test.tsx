/**
 * Tests for LayerItem component
 *
 * Verifies slider interaction doesn't trigger layer drag,
 * and that drag handle works correctly.
 *
 * @module features/Map/components/__tests__
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayerItem } from './LayerItem.js';
import type { GeoJSONLayerConfig } from '../types/layer.js';

// =============================================================================
// Test Data
// =============================================================================

const createTestLayer = (overrides?: Partial<GeoJSONLayerConfig>): GeoJSONLayerConfig => ({
  id: 'test-layer-1',
  name: 'Test Vector Layer',
  type: 'geojson',
  visible: true,
  opacity: 0.75,
  zIndex: 0,
  data: { type: 'FeatureCollection', features: [] },
  ...overrides,
});

// =============================================================================
// Tests
// =============================================================================

describe('LayerItem', () => {
  const defaultProps = {
    layer: createTestLayer(),
    isSelected: false,
    onToggleVisibility: vi.fn(),
    onOpacityChange: vi.fn(),
    onRemove: vi.fn(),
    onSelect: vi.fn(),
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
    onDragEnd: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders layer name', () => {
      render(<LayerItem {...defaultProps} />);
      expect(screen.getByText('Test Vector Layer')).toBeInTheDocument();
    });

    it('renders opacity slider with correct value', () => {
      render(<LayerItem {...defaultProps} />);
      const slider = screen.getByTestId('layer-opacity-slider');
      expect(slider).toHaveValue('75');
    });

    it('renders drag handle', () => {
      render(<LayerItem {...defaultProps} />);
      const dragHandle = screen.getByTestId('layer-drag-handle');
      expect(dragHandle).toBeInTheDocument();
    });

    it('renders visibility toggle button', () => {
      render(<LayerItem {...defaultProps} />);
      const visibilityBtn = screen.getByTitle('Hide layer');
      expect(visibilityBtn).toBeInTheDocument();
    });

    it('renders remove button', () => {
      render(<LayerItem {...defaultProps} />);
      const removeBtn = screen.getByTitle('Remove layer');
      expect(removeBtn).toBeInTheDocument();
    });
  });

  describe('opacity slider interaction', () => {
    it('calls onOpacityChange when slider is changed', async () => {
      const onOpacityChange = vi.fn();
      render(<LayerItem {...defaultProps} onOpacityChange={onOpacityChange} />);

      const slider = screen.getByTestId('layer-opacity-slider');
      fireEvent.change(slider, { target: { value: '50' } });

      expect(onOpacityChange).toHaveBeenCalledWith(0.5);
    });

    it('slider mousedown stops propagation (prevents drag)', () => {
      render(<LayerItem {...defaultProps} />);

      const slider = screen.getByTestId('layer-opacity-slider');
      const mouseDownEvent = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });

      // Spy on stopPropagation
      const stopPropagationSpy = vi.spyOn(mouseDownEvent, 'stopPropagation');
      slider.dispatchEvent(mouseDownEvent);

      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it('slider click stops propagation', async () => {
      const onSelect = vi.fn();
      render(<LayerItem {...defaultProps} onSelect={onSelect} />);

      const slider = screen.getByTestId('layer-opacity-slider');

      // Click on the slider
      await userEvent.click(slider);

      // onSelect should NOT be called because click was on slider
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe('drag handle behavior', () => {
    it('renders a drag handle with correct title', () => {
      render(<LayerItem {...defaultProps} />);

      const dragHandle = screen.getByTestId('layer-drag-handle');
      expect(dragHandle).toHaveAttribute('title', 'Drag to reorder');
    });

    it('drag handle has grip icon', () => {
      render(<LayerItem {...defaultProps} />);

      const dragHandle = screen.getByTestId('layer-drag-handle');
      const gripIcon = dragHandle.querySelector('.fa-grip-vertical');
      expect(gripIcon).toBeInTheDocument();
    });
  });

  describe('visibility toggle', () => {
    it('calls onToggleVisibility when clicked', async () => {
      const onToggleVisibility = vi.fn();
      render(<LayerItem {...defaultProps} onToggleVisibility={onToggleVisibility} />);

      const visibilityBtn = screen.getByTitle('Hide layer');
      await userEvent.click(visibilityBtn);

      expect(onToggleVisibility).toHaveBeenCalled();
    });

    it('shows correct icon for hidden layer', () => {
      const hiddenLayer = createTestLayer({ visible: false });
      render(<LayerItem {...defaultProps} layer={hiddenLayer} />);

      const visibilityBtn = screen.getByTitle('Show layer');
      expect(visibilityBtn).toBeInTheDocument();
    });
  });

  describe('remove button', () => {
    it('calls onRemove when clicked', async () => {
      const onRemove = vi.fn();
      render(<LayerItem {...defaultProps} onRemove={onRemove} />);

      const removeBtn = screen.getByTitle('Remove layer');
      await userEvent.click(removeBtn);

      expect(onRemove).toHaveBeenCalled();
    });
  });

  describe('selection', () => {
    it('calls onSelect when layer card is clicked', async () => {
      const onSelect = vi.fn();
      render(<LayerItem {...defaultProps} onSelect={onSelect} />);

      // Click on layer name (not on buttons)
      const layerName = screen.getByText('Test Vector Layer');
      await userEvent.click(layerName);

      expect(onSelect).toHaveBeenCalled();
    });

    it('applies selected background when isSelected is true', () => {
      const { container } = render(<LayerItem {...defaultProps} isSelected={true} />);

      // The container should have selected background color
      const layerCard = container.querySelector('[draggable="true"]');
      expect(layerCard).toHaveStyle({ backgroundColor: 'rgb(227, 242, 253)' });
    });
  });

  describe('drag state styling', () => {
    it('applies dragging styles when isDragging is true', () => {
      const { container } = render(<LayerItem {...defaultProps} isDragging={true} />);

      const layerCard = container.querySelector('[draggable="true"]');
      expect(layerCard).toHaveStyle({ opacity: '0.5' });
    });

    it('applies opacity style when isDragOver is true', () => {
      const { container } = render(<LayerItem {...defaultProps} isDragOver={true} />);

      // When dragging over, the component still has normal opacity (not dragging itself)
      const layerCard = container.querySelector('[draggable="true"]');
      expect(layerCard).toHaveStyle({ opacity: '1' });
    });
  });

  describe('layer type indicators', () => {
    it('shows vector icon for geojson layer', () => {
      render(<LayerItem {...defaultProps} />);

      const vectorIcon = screen.getByTitle('Vector layer');
      expect(vectorIcon).toBeInTheDocument();
    });

    it('shows raster icon for raster layer', () => {
      const rasterLayer = {
        id: 'raster-1',
        name: 'Test Raster',
        type: 'raster' as const,
        visible: true,
        opacity: 1,
        zIndex: 0,
        url: 'http://example.com/tiles/{z}/{x}/{y}.png',
      };

      render(<LayerItem {...defaultProps} layer={rasterLayer} />);

      const rasterIcon = screen.getByTitle('Raster layer');
      expect(rasterIcon).toBeInTheDocument();
    });
  });

  describe('breaks mode indicator', () => {
    it('shows static breaks indicator', () => {
      const layerWithBreaks = createTestLayer({ breaksMode: 'static' });
      render(<LayerItem {...defaultProps} layer={layerWithBreaks} />);

      const indicator = screen.getByTitle(/static breaks/i);
      expect(indicator).toBeInTheDocument();
    });

    it('shows dynamic breaks indicator', () => {
      const layerWithBreaks = createTestLayer({ breaksMode: 'dynamic' });
      render(<LayerItem {...defaultProps} layer={layerWithBreaks} />);

      const indicator = screen.getByTitle(/dynamic breaks/i);
      expect(indicator).toBeInTheDocument();
    });
  });
});
