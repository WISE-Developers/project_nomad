/**
 * Tests for StatusMonitor component
 *
 * Verifies spinner display for running jobs (FireSTARR doesn't support progress updates)
 *
 * @module features/Dashboard/components/__tests__
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StatusMonitor } from './StatusMonitor.js';
import { DashboardProvider } from '../context/DashboardContext.js';
import { OpenNomadProvider } from '../../../openNomad/context/OpenNomadContext.js';
import { createMockOpenNomadAPI } from '../../../test/mocks/openNomad.js';
import type { IOpenNomadAPI, Job } from '../../../openNomad/api.js';

// =============================================================================
// Test Wrapper
// =============================================================================

function createWrapper(mockApi: IOpenNomadAPI, initialJobs: Job[] = []) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <OpenNomadProvider adapter={mockApi}>
        <DashboardProvider initialState={{ activeJobs: initialJobs }}>
          {children}
        </DashboardProvider>
      </OpenNomadProvider>
    );
  };
}

// =============================================================================
// Test Jobs
// =============================================================================

const createRunningJob = (): Job => ({
  id: 'job-1',
  modelId: 'NOMAD-20240101-00001',
  status: 'running',
  progress: 0,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  resultIds: [],
});

const createPendingJob = (): Job => ({
  id: 'job-2',
  modelId: 'NOMAD-20240101-00002',
  status: 'pending',
  progress: 0,
  createdAt: new Date().toISOString(),
  resultIds: [],
});

const createCompletedJob = (): Job => ({
  id: 'job-3',
  modelId: 'NOMAD-20240101-00003',
  status: 'completed',
  progress: 100,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  resultIds: ['result-1'],
});

// =============================================================================
// Tests
// =============================================================================

describe('StatusMonitor', () => {
  let mockApi: IOpenNomadAPI;

  beforeEach(() => {
    mockApi = createMockOpenNomadAPI();
  });

  describe('empty state', () => {
    it('shows empty state when no jobs', () => {
      const Wrapper = createWrapper(mockApi, []);

      render(
        <Wrapper>
          <StatusMonitor />
        </Wrapper>
      );

      expect(screen.getByText('All Caught Up')).toBeInTheDocument();
      expect(screen.getByText(/no jobs are currently running/i)).toBeInTheDocument();
    });
  });

  describe('running jobs', () => {
    it('shows spinner for running job instead of progress bar', async () => {
      const Wrapper = createWrapper(mockApi, [createRunningJob()]);

      render(
        <Wrapper>
          <StatusMonitor />
        </Wrapper>
      );

      // Should show "Running..." text
      await waitFor(() => {
        expect(screen.getByText('Running...')).toBeInTheDocument();
      });

      // Should NOT show percentage progress
      expect(screen.queryByText('0%')).not.toBeInTheDocument();
      expect(screen.queryByText('% complete')).not.toBeInTheDocument();
    });

    it('shows "Queued..." for pending job', async () => {
      const Wrapper = createWrapper(mockApi, [createPendingJob()]);

      render(
        <Wrapper>
          <StatusMonitor />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Queued...')).toBeInTheDocument();
      });
    });

    it('shows active job count', async () => {
      const Wrapper = createWrapper(mockApi, [createRunningJob(), createPendingJob()]);

      render(
        <Wrapper>
          <StatusMonitor />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('2 active jobs')).toBeInTheDocument();
      });
    });
  });

  describe('completed jobs', () => {
    it('shows "Completed successfully" for completed job', async () => {
      const Wrapper = createWrapper(mockApi, [createCompletedJob()]);

      render(
        <Wrapper>
          <StatusMonitor />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Completed successfully')).toBeInTheDocument();
      });
    });

    it('shows dismiss button for completed jobs', async () => {
      const Wrapper = createWrapper(mockApi, [createCompletedJob()]);

      render(
        <Wrapper>
          <StatusMonitor />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
      });
    });
  });

  describe('header', () => {
    it('shows "No active jobs" when only completed jobs exist', async () => {
      const Wrapper = createWrapper(mockApi, [createCompletedJob()]);

      render(
        <Wrapper>
          <StatusMonitor />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('No active jobs')).toBeInTheDocument();
      });
    });

    it('shows "Clear completed" button when completed jobs exist', async () => {
      const Wrapper = createWrapper(mockApi, [createCompletedJob()]);

      render(
        <Wrapper>
          <StatusMonitor />
        </Wrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /clear completed/i })).toBeInTheDocument();
      });
    });
  });
});
