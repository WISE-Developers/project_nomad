/**
 * Tests for OpenNomadContext
 *
 * Verifies the context provider correctly provides the API
 * and hooks work as expected.
 *
 * @module openNomad/context/__tests__
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { OpenNomadProvider, useOpenNomad, useOpenNomadOptional } from './OpenNomadContext.js';
import { createMockOpenNomadAPI, mockUser } from '../../test/mocks/openNomad.js';
import type { IOpenNomadAPI } from '../api.js';

// =============================================================================
// Test Components
// =============================================================================

function TestConsumer() {
  const api = useOpenNomad();
  const [user, setUser] = React.useState<string>('loading');

  React.useEffect(() => {
    api.auth.getCurrentUser().then((u) => setUser(u?.name ?? 'none'));
  }, [api]);

  return <div data-testid="user-name">{user}</div>;
}

function TestOptionalConsumer() {
  const api = useOpenNomadOptional();
  return <div data-testid="has-api">{api ? 'yes' : 'no'}</div>;
}

// =============================================================================
// Tests
// =============================================================================

describe('OpenNomadContext', () => {
  let mockApi: IOpenNomadAPI;

  beforeEach(() => {
    mockApi = createMockOpenNomadAPI();
  });

  describe('OpenNomadProvider', () => {
    it('provides the API to child components', async () => {
      render(
        <OpenNomadProvider adapter={mockApi}>
          <TestConsumer />
        </OpenNomadProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('user-name')).toHaveTextContent(mockUser.name);
      });
    });

    it('throws when useOpenNomad is used outside provider', () => {
      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestConsumer />);
      }).toThrow('useOpenNomad must be used within an OpenNomadProvider');

      consoleSpy.mockRestore();
    });
  });

  describe('useOpenNomadOptional', () => {
    it('returns null when used outside provider', () => {
      render(<TestOptionalConsumer />);
      expect(screen.getByTestId('has-api')).toHaveTextContent('no');
    });

    it('returns the API when used inside provider', () => {
      render(
        <OpenNomadProvider adapter={mockApi}>
          <TestOptionalConsumer />
        </OpenNomadProvider>
      );
      expect(screen.getByTestId('has-api')).toHaveTextContent('yes');
    });
  });

  describe('API modules', () => {
    it('provides auth module', async () => {
      render(
        <OpenNomadProvider adapter={mockApi}>
          <TestConsumer />
        </OpenNomadProvider>
      );

      await waitFor(() => {
        expect(mockApi.auth.getCurrentUser).toHaveBeenCalled();
      });
    });

    it('provides models module', async () => {
      function ModelsTest() {
        const api = useOpenNomad();
        React.useEffect(() => {
          api.models.list();
        }, [api]);
        return null;
      }

      render(
        <OpenNomadProvider adapter={mockApi}>
          <ModelsTest />
        </OpenNomadProvider>
      );

      await waitFor(() => {
        expect(mockApi.models.list).toHaveBeenCalled();
      });
    });

    it('provides jobs module', async () => {
      function JobsTest() {
        const api = useOpenNomad();
        React.useEffect(() => {
          api.jobs.getStatus('job-1');
        }, [api]);
        return null;
      }

      render(
        <OpenNomadProvider adapter={mockApi}>
          <JobsTest />
        </OpenNomadProvider>
      );

      await waitFor(() => {
        expect(mockApi.jobs.getStatus).toHaveBeenCalledWith('job-1');
      });
    });

    it('provides results module', async () => {
      function ResultsTest() {
        const api = useOpenNomad();
        React.useEffect(() => {
          api.results.getExportFormats();
        }, [api]);
        return null;
      }

      render(
        <OpenNomadProvider adapter={mockApi}>
          <ResultsTest />
        </OpenNomadProvider>
      );

      await waitFor(() => {
        expect(mockApi.results.getExportFormats).toHaveBeenCalled();
      });
    });

    it('provides config module', async () => {
      function ConfigTest() {
        const api = useOpenNomad();
        React.useEffect(() => {
          api.config.getAvailableEngines();
        }, [api]);
        return null;
      }

      render(
        <OpenNomadProvider adapter={mockApi}>
          <ConfigTest />
        </OpenNomadProvider>
      );

      await waitFor(() => {
        expect(mockApi.config.getAvailableEngines).toHaveBeenCalled();
      });
    });
  });
});
