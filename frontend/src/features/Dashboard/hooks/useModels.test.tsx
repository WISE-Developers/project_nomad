/**
 * Tests for useModels hook
 *
 * Verifies the hook correctly interacts with the openNomad API
 * and integrates with DashboardContext.
 *
 * @module features/Dashboard/hooks/__tests__
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useModels } from './useModels.js';
import { OpenNomadProvider } from '../../../openNomad/context/OpenNomadContext.js';
import { DashboardProvider } from '../context/DashboardContext.js';
import { createMockOpenNomadAPI, mockModels } from '../../../test/mocks/openNomad.js';
import type { IOpenNomadAPI } from '../../../openNomad/api.js';

// =============================================================================
// Test Component
// =============================================================================

interface TestComponentProps {
  onResult?: (result: ReturnType<typeof useModels>) => void;
}

function TestComponent({ onResult }: TestComponentProps) {
  const result = useModels({ autoFetch: true });

  React.useEffect(() => {
    onResult?.(result);
  }, [result, onResult]);

  return (
    <div>
      <div data-testid="loading">{result.isLoading ? 'loading' : 'loaded'}</div>
      <div data-testid="error">{result.error ?? 'no-error'}</div>
      <div data-testid="model-count">{result.models.length}</div>
      <ul data-testid="models">
        {result.models.map((m) => (
          <li key={m.id} data-testid={`model-${m.id}`}>
            {m.name}
          </li>
        ))}
      </ul>
      <button onClick={() => result.refresh()} data-testid="refresh">
        Refresh
      </button>
      <button onClick={() => result.deleteModel('model-1')} data-testid="delete">
        Delete
      </button>
    </div>
  );
}

// =============================================================================
// Test Wrapper
// =============================================================================

function createWrapper(mockApi: IOpenNomadAPI) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <OpenNomadProvider adapter={mockApi}>
        <DashboardProvider>{children}</DashboardProvider>
      </OpenNomadProvider>
    );
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('useModels', () => {
  let mockApi: IOpenNomadAPI;

  beforeEach(() => {
    mockApi = createMockOpenNomadAPI();
  });

  describe('loading models', () => {
    it('loads models on mount when autoLoad is true', async () => {
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <TestComponent />
        </Wrapper>
      );

      // Initially loading
      expect(screen.getByTestId('loading')).toHaveTextContent('loading');

      // Wait for models to load
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      expect(screen.getByTestId('model-count')).toHaveTextContent('2');
      expect(mockApi.models.list).toHaveBeenCalled();
    });

    it('does not load on mount when autoFetch is false', async () => {
      function NoAutoLoad() {
        const result = useModels({ autoFetch: false });
        return <div data-testid="count">{result.models.length}</div>;
      }

      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <NoAutoLoad />
        </Wrapper>
      );

      // Should not call list immediately
      expect(mockApi.models.list).not.toHaveBeenCalled();
      expect(screen.getByTestId('count')).toHaveTextContent('0');
    });

    it('displays models correctly', async () => {
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <TestComponent />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      expect(screen.getByTestId('model-model-1')).toHaveTextContent('Test Fire Model 1');
      expect(screen.getByTestId('model-model-2')).toHaveTextContent('Test Fire Model 2');
    });
  });

  describe('refresh', () => {
    it('reloads models when refresh is called', async () => {
      const user = userEvent.setup();
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <TestComponent />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      // First call on mount
      expect(mockApi.models.list).toHaveBeenCalledTimes(1);

      // Click refresh
      await user.click(screen.getByTestId('refresh'));

      await waitFor(() => {
        expect(mockApi.models.list).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('delete', () => {
    it('calls delete API and refreshes list', async () => {
      const user = userEvent.setup();
      const Wrapper = createWrapper(mockApi);

      render(
        <Wrapper>
          <TestComponent />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loaded');
      });

      await user.click(screen.getByTestId('delete'));

      await waitFor(() => {
        expect(mockApi.models.delete).toHaveBeenCalledWith('model-1');
      });
    });
  });

  describe('error handling', () => {
    it('handles API errors gracefully', async () => {
      const errorApi = createMockOpenNomadAPI();
      vi.mocked(errorApi.models.list).mockRejectedValue(new Error('API Error'));

      const Wrapper = createWrapper(errorApi);

      render(
        <Wrapper>
          <TestComponent />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('API Error');
      });
    });
  });
});
