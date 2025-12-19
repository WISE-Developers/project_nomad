/**
 * Tests for DashboardContainer
 *
 * Verifies both floating (SAN) and embedded (ACN) modes work correctly.
 *
 * @module features/Dashboard/components/__tests__
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardContainer } from './DashboardContainer.js';
import { OpenNomadProvider } from '../../../openNomad/context/OpenNomadContext.js';
import { createMockOpenNomadAPI } from '../../../test/mocks/openNomad.js';
import type { IOpenNomadAPI } from '../../../openNomad/api.js';

// =============================================================================
// Test Wrapper
// =============================================================================

function createWrapper(mockApi: IOpenNomadAPI) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <OpenNomadProvider adapter={mockApi}>{children}</OpenNomadProvider>;
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('DashboardContainer', () => {
  let mockApi: IOpenNomadAPI;

  beforeEach(() => {
    mockApi = createMockOpenNomadAPI();
  });

  describe('common functionality', () => {
    it('renders with default tab (models)', async () => {
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <DashboardContainer mode="embedded" />
        </Wrapper>
      );

      // Should show Models tab as active
      const modelsTab = screen.getByRole('tab', { name: /models/i });
      expect(modelsTab).toHaveAttribute('aria-selected', 'true');
    });

    it('respects initialTab prop', async () => {
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <DashboardContainer mode="embedded" initialTab="drafts" />
        </Wrapper>
      );

      // Should show Drafts tab as active
      const draftsTab = screen.getByRole('tab', { name: /drafts/i });
      expect(draftsTab).toHaveAttribute('aria-selected', 'true');
    });

    it('switches tabs when clicked', async () => {
      const user = userEvent.setup();
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <DashboardContainer mode="embedded" />
        </Wrapper>
      );

      // Click on Drafts tab
      await user.click(screen.getByRole('tab', { name: /drafts/i }));

      // Should now be active
      const draftsTab = screen.getByRole('tab', { name: /drafts/i });
      expect(draftsTab).toHaveAttribute('aria-selected', 'true');
    });

    it('calls onLaunchWizard when new model button is clicked', async () => {
      const user = userEvent.setup();
      const onLaunchWizard = vi.fn();
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <DashboardContainer mode="embedded" onLaunchWizard={onLaunchWizard} />
        </Wrapper>
      );

      // Wait for content to load
      await waitFor(() => {
        expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
      });

      // Find and click the new model button
      const newButton = screen.getByRole('button', { name: /new|create/i });
      await user.click(newButton);

      expect(onLaunchWizard).toHaveBeenCalled();
    });
  });

  describe('embedded mode (ACN)', () => {
    it('renders without close button', () => {
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <DashboardContainer mode="embedded" />
        </Wrapper>
      );

      // Should not have a close button
      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    });

    it('applies embedded class', () => {
      const Wrapper = createWrapper(mockApi);

      const { container } = render(
        <Wrapper>
          <DashboardContainer mode="embedded" className="custom-class" />
        </Wrapper>
      );

      const embeddedDiv = container.querySelector('.dashboard-embedded');
      expect(embeddedDiv).toBeInTheDocument();
      expect(embeddedDiv).toHaveClass('custom-class');
    });

    it('fills parent container height', () => {
      const Wrapper = createWrapper(mockApi);

      const { container } = render(
        <Wrapper>
          <DashboardContainer mode="embedded" />
        </Wrapper>
      );

      const embeddedDiv = container.querySelector('.dashboard-embedded');
      expect(embeddedDiv).toHaveStyle({ height: '100%' });
    });

    it('has no drag hint text', () => {
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <DashboardContainer mode="embedded" />
        </Wrapper>
      );

      expect(screen.queryByText(/drag to move/i)).not.toBeInTheDocument();
    });
  });

  describe('floating mode (SAN)', () => {
    it('renders with close button', () => {
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <DashboardContainer mode="floating" />
        </Wrapper>
      );

      // Should have a close button
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <DashboardContainer mode="floating" onClose={onClose} />
        </Wrapper>
      );

      await user.click(screen.getByRole('button', { name: /close/i }));
      expect(onClose).toHaveBeenCalled();
    });

    it('has drag hint text', () => {
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <DashboardContainer mode="floating" />
        </Wrapper>
      );

      expect(screen.getByText(/drag to move/i)).toBeInTheDocument();
    });

    it('applies floating panel class', () => {
      const Wrapper = createWrapper(mockApi);

      const { container } = render(
        <Wrapper>
          <DashboardContainer mode="floating" className="custom-class" />
        </Wrapper>
      );

      const panelDiv = container.querySelector('.dashboard-panel');
      expect(panelDiv).toBeInTheDocument();
      expect(panelDiv).toHaveClass('custom-class');
    });
  });

  describe('callbacks', () => {
    it('passes onViewResults to model list', async () => {
      const user = userEvent.setup();
      const onViewResults = vi.fn();
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <DashboardContainer mode="embedded" onViewResults={onViewResults} />
        </Wrapper>
      );

      // Wait for models to load
      await waitFor(() => {
        expect(screen.getByText('Test Fire Model 1')).toBeInTheDocument();
      });

      // Click on view button for model 1
      const viewButtons = screen.getAllByRole('button', { name: /view/i });
      await user.click(viewButtons[0]);

      expect(onViewResults).toHaveBeenCalledWith('model-1');
    });
  });
});
