/**
 * useJobs Hook
 *
 * Manages active job tracking and status subscriptions for the Dashboard.
 * Uses the openNomad API for job status polling and integrates with DashboardContext.
 *
 * @module features/Dashboard/hooks
 */

import { useCallback, useEffect, useRef } from 'react';
import { useOpenNomad } from '../../../openNomad/index.js';
import { useDashboard } from '../context/DashboardContext.js';
import type { Job, JobStatusDetail, Unsubscribe } from '../../../openNomad/api.js';

// =============================================================================
// Types
// =============================================================================

export interface UseJobsOptions {
  /** Automatically subscribe to all running jobs on mount */
  autoSubscribeRunning?: boolean;
}

export interface JobInfo extends Job {
  /** Whether this job is being actively watched */
  isWatching: boolean;
  /** Detailed status info from last update */
  detail?: JobStatusDetail;
}

export interface UseJobsReturn {
  /** Active jobs being tracked */
  jobs: Job[];
  /** Currently focused job ID */
  focusedJobId: string | null;
  /** Whether jobs are loading */
  isLoading: boolean;
  /** Error message if job fetch failed */
  error: string | null;
  /** Number of running jobs */
  runningCount: number;
  /** Number of pending jobs */
  pendingCount: number;

  // Actions
  /** Start watching a job for status changes */
  watchJob: (jobId: string) => void;
  /** Stop watching a specific job */
  stopWatching: (jobId: string) => void;
  /** Stop watching all jobs */
  stopWatchingAll: () => void;
  /** Get current job status */
  getJobStatus: (jobId: string) => Promise<JobStatusDetail>;
  /** Set the focused job for detail view */
  setFocusedJob: (jobId: string | null) => void;
  /** Check if a job is being watched */
  isWatching: (jobId: string) => boolean;
  /** Add a job to tracking (without watching) */
  addJob: (job: Job) => void;
  /** Remove a job from tracking */
  removeJob: (jobId: string) => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing job status tracking in the Dashboard.
 *
 * Provides methods to watch jobs for real-time updates and manages
 * active subscriptions with automatic cleanup.
 */
export function useJobs(options: UseJobsOptions = {}): UseJobsReturn {
  const { autoSubscribeRunning = false } = options;

  // API access
  const api = useOpenNomad();

  // Dashboard context
  const { state, dispatch } = useDashboard();

  // Track active subscriptions for cleanup
  const subscriptionsRef = useRef<Map<string, Unsubscribe>>(new Map());

  // Track mounted state
  const mountedRef = useRef(true);

  // ==========================================================================
  // Subscription Management
  // ==========================================================================

  /**
   * Start watching a job for status changes.
   */
  const watchJob = useCallback((jobId: string) => {
    // Already watching?
    if (subscriptionsRef.current.has(jobId)) {
      return;
    }

    // Subscribe to status changes
    const unsubscribe = api.jobs.onStatusChange(jobId, (status: JobStatusDetail) => {
      if (!mountedRef.current) return;

      // Map JobStatusDetail back to Job
      const job: Job = {
        id: status.id,
        modelId: status.modelId,
        status: status.status,
        progress: status.progress,
        createdAt: status.createdAt,
        startedAt: status.startedAt,
        completedAt: status.completedAt,
        error: status.error,
        resultIds: status.resultIds,
      };

      // Update job in context
      dispatch({ type: 'UPDATE_JOB', job });

      // If job is terminal, stop watching
      if (
        status.status === 'completed' ||
        status.status === 'failed' ||
        status.status === 'cancelled'
      ) {
        subscriptionsRef.current.delete(jobId);
      }
    });

    subscriptionsRef.current.set(jobId, unsubscribe);
  }, [api, dispatch]);

  /**
   * Stop watching a specific job.
   */
  const stopWatching = useCallback((jobId: string) => {
    const unsubscribe = subscriptionsRef.current.get(jobId);
    if (unsubscribe) {
      unsubscribe();
      subscriptionsRef.current.delete(jobId);
    }
  }, []);

  /**
   * Stop watching all jobs.
   */
  const stopWatchingAll = useCallback(() => {
    subscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
    subscriptionsRef.current.clear();
  }, []);

  /**
   * Get current job status.
   */
  const getJobStatus = useCallback(async (jobId: string): Promise<JobStatusDetail> => {
    return api.jobs.getStatus(jobId);
  }, [api]);

  /**
   * Set the focused job for detail view.
   */
  const setFocusedJob = useCallback((jobId: string | null) => {
    dispatch({ type: 'SET_FOCUSED_JOB', id: jobId });
  }, [dispatch]);

  /**
   * Check if a job is being watched.
   */
  const isWatching = useCallback((jobId: string): boolean => {
    return subscriptionsRef.current.has(jobId);
  }, []);

  /**
   * Add a job to tracking.
   */
  const addJob = useCallback((job: Job) => {
    dispatch({ type: 'ADD_JOB', job });
  }, [dispatch]);

  /**
   * Remove a job from tracking.
   */
  const removeJob = useCallback((jobId: string) => {
    // Stop watching first
    stopWatching(jobId);
    // Remove from state
    dispatch({ type: 'REMOVE_JOB', id: jobId });
  }, [dispatch, stopWatching]);

  // ==========================================================================
  // Auto-subscribe to running jobs
  // ==========================================================================

  useEffect(() => {
    if (!autoSubscribeRunning) return;

    // Watch all jobs that are pending or running
    state.activeJobs.forEach((job) => {
      if (job.status === 'pending' || job.status === 'running') {
        watchJob(job.id);
      }
    });
  }, [autoSubscribeRunning, state.activeJobs, watchJob]);

  // ==========================================================================
  // Cleanup on unmount
  // ==========================================================================

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // Clean up all subscriptions
      subscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
      subscriptionsRef.current.clear();
    };
  }, []);

  // ==========================================================================
  // Computed values
  // ==========================================================================

  const runningCount = state.activeJobs.filter(
    (job) => job.status === 'running'
  ).length;

  const pendingCount = state.activeJobs.filter(
    (job) => job.status === 'pending'
  ).length;

  return {
    jobs: state.activeJobs,
    focusedJobId: state.focusedJobId,
    isLoading: state.jobsLoading.isLoading,
    error: state.jobsLoading.error,
    runningCount,
    pendingCount,

    watchJob,
    stopWatching,
    stopWatchingAll,
    getJobStatus,
    setFocusedJob,
    isWatching,
    addJob,
    removeJob,
  };
}

// =============================================================================
// Utility Hook: Single Job Watcher
// =============================================================================

export interface UseJobWatcherOptions {
  /** Whether to auto-start watching */
  autoWatch?: boolean;
  /** Callback when status changes */
  onStatusChange?: (status: JobStatusDetail) => void;
  /** Callback when job completes */
  onComplete?: (status: JobStatusDetail) => void;
  /** Callback when job fails */
  onFail?: (status: JobStatusDetail) => void;
}

/**
 * Hook for watching a single job's status.
 *
 * Useful for components that need to display status of one specific job.
 */
export function useJobWatcher(
  jobId: string | null,
  options: UseJobWatcherOptions = {}
) {
  const {
    autoWatch = true,
    onStatusChange,
    onComplete,
    onFail,
  } = options;

  const api = useOpenNomad();
  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const mountedRef = useRef(true);

  // Track latest status
  const statusRef = useRef<JobStatusDetail | null>(null);

  const startWatching = useCallback(() => {
    if (!jobId || unsubscribeRef.current) return;

    unsubscribeRef.current = api.jobs.onStatusChange(jobId, (status) => {
      if (!mountedRef.current) return;

      statusRef.current = status;
      onStatusChange?.(status);

      if (status.status === 'completed') {
        onComplete?.(status);
      } else if (status.status === 'failed') {
        onFail?.(status);
      }
    });
  }, [jobId, api, onStatusChange, onComplete, onFail]);

  const stopWatching = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  }, []);

  // Auto-watch
  useEffect(() => {
    if (autoWatch && jobId) {
      startWatching();
    }

    return () => {
      stopWatching();
    };
  }, [autoWatch, jobId, startWatching, stopWatching]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      stopWatching();
    };
  }, [stopWatching]);

  return {
    status: statusRef.current,
    isWatching: !!unsubscribeRef.current,
    startWatching,
    stopWatching,
  };
}
