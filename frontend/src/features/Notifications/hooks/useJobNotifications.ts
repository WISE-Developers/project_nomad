/**
 * Job Notifications Hook
 *
 * Manages SSE connections for real-time job status updates
 * and browser notifications for model completion.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface JobStatus {
  id: string;
  modelId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface UseJobNotificationsOptions {
  /** Enable browser notifications */
  enableBrowserNotifications?: boolean;
  /** Callback when job status changes */
  onStatusChange?: (status: JobStatus) => void;
  /** Callback when job completes */
  onComplete?: (status: JobStatus) => void;
  /** Callback when job fails */
  onError?: (status: JobStatus) => void;
}

interface UseJobNotificationsResult {
  /** Current job status */
  status: JobStatus | null;
  /** Whether connected to SSE stream */
  isConnected: boolean;
  /** Any connection error */
  error: string | null;
  /** Start watching a job */
  watchJob: (jobId: string) => void;
  /** Stop watching the current job */
  stopWatching: () => void;
  /** Request browser notification permission */
  requestPermission: () => Promise<NotificationPermission>;
  /** Current notification permission status */
  permissionStatus: NotificationPermission;
}

/**
 * Hook for managing job notifications via SSE
 */
export function useJobNotifications(
  options: UseJobNotificationsOptions = {}
): UseJobNotificationsResult {
  const {
    enableBrowserNotifications = true,
    onStatusChange,
    onComplete,
    onError,
  } = options;

  const [status, setStatus] = useState<JobStatus | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  const eventSourceRef = useRef<EventSource | null>(null);
  const jobIdRef = useRef<string | null>(null);

  // Request notification permission
  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (typeof Notification === 'undefined') {
      return 'denied';
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    const result = await Notification.requestPermission();
    setPermissionStatus(result);
    return result;
  }, []);

  // Show browser notification
  const showBrowserNotification = useCallback(
    (title: string, body: string, data?: { url?: string }) => {
      if (!enableBrowserNotifications) return;
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;

      // Check if service worker is available for push-like notification
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          payload: { title, body, data },
        });
      } else {
        // Fallback to direct notification
        new Notification(title, {
          body,
          icon: '/favicon.png',
          tag: 'job-notification',
          data,
        });
      }
    },
    [enableBrowserNotifications]
  );

  // Stop watching current job
  const stopWatching = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    jobIdRef.current = null;
    setIsConnected(false);
  }, []);

  // Start watching a job
  const watchJob = useCallback(
    (jobId: string) => {
      // Close existing connection
      stopWatching();

      jobIdRef.current = jobId;
      setError(null);

      // Create EventSource for SSE
      const eventSource = new EventSource(`/api/v1/jobs/${jobId}/stream`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as JobStatus;
          setStatus(data);
          onStatusChange?.(data);

          // Handle terminal states
          if (data.status === 'completed') {
            showBrowserNotification(
              'Model Complete',
              `Your fire model has finished running.`,
              { url: `/models/${data.modelId}/results` }
            );
            onComplete?.(data);
          } else if (data.status === 'failed') {
            showBrowserNotification(
              'Model Failed',
              data.error || 'An error occurred during execution.',
              { url: `/models/${data.modelId}` }
            );
            onError?.(data);
          }
        } catch (e) {
          console.error('[useJobNotifications] Failed to parse SSE data:', e);
        }
      };

      eventSource.addEventListener('complete', () => {
        setIsConnected(false);
        eventSource.close();
      });

      eventSource.addEventListener('error', (event) => {
        const errorEvent = event as Event & { data?: string };
        try {
          const data = errorEvent.data ? JSON.parse(errorEvent.data) : {};
          setError(data.error || 'Connection error');
        } catch {
          setError('Connection lost');
        }
        setIsConnected(false);
      });

      eventSource.onerror = () => {
        // Don't set error immediately - SSE reconnects automatically
        // Only set error if we're still supposed to be watching
        if (jobIdRef.current === jobId) {
          setIsConnected(false);
        }
      };
    },
    [stopWatching, onStatusChange, onComplete, onError, showBrowserNotification]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopWatching();
    };
  }, [stopWatching]);

  return {
    status,
    isConnected,
    error,
    watchJob,
    stopWatching,
    requestPermission,
    permissionStatus,
  };
}

export default useJobNotifications;
