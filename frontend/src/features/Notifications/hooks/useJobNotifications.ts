/**
 * Job Notifications Hook
 *
 * Manages SSE connections for real-time job status updates
 * and browser notifications for model completion.
 *
 * Fetches user notification preferences from the backend and respects
 * toast_enabled / browser_enabled flags per event type.
 * Registers the service worker on first call.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getNotificationPreferences,
  type NotificationPreference,
  type NotificationEventType,
} from '../../../services/api';
import { registerServiceWorker } from '../../../services/serviceWorker';

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
  /** Enable browser notifications (can be overridden per event type by preferences) */
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

/** Default preferences — toast on, browser off — used until API response arrives */
function defaultPrefs(): Map<NotificationEventType, NotificationPreference> {
  const eventTypes: NotificationEventType[] = [
    'model_completed',
    'model_failed',
    'import_completed',
    'import_failed',
  ];
  return new Map(
    eventTypes.map((eventType) => [
      eventType,
      { userId: '', eventType, toastEnabled: true, browserEnabled: false },
    ])
  );
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
  const prefsRef = useRef<Map<NotificationEventType, NotificationPreference>>(defaultPrefs());

  // Register service worker and fetch preferences on mount
  useEffect(() => {
    void registerServiceWorker();

    getNotificationPreferences()
      .then(({ preferences }) => {
        const map = new Map<NotificationEventType, NotificationPreference>();
        for (const pref of preferences) {
          map.set(pref.eventType, pref);
        }
        prefsRef.current = map;
      })
      .catch((err) => {
        console.warn('[useJobNotifications] Could not fetch notification preferences:', err);
        // Keep defaults — non-fatal
      });
  }, []);

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

  // Check if toast is enabled for a given event type
  const isToastEnabled = useCallback((eventType: NotificationEventType): boolean => {
    return prefsRef.current.get(eventType)?.toastEnabled ?? true;
  }, []);

  // Check if browser notification is enabled for a given event type
  const isBrowserEnabled = useCallback((eventType: NotificationEventType): boolean => {
    return prefsRef.current.get(eventType)?.browserEnabled ?? false;
  }, []);

  // Show browser notification
  const showBrowserNotification = useCallback(
    (
      eventType: NotificationEventType,
      title: string,
      body: string,
      data?: { url?: string }
    ) => {
      if (!enableBrowserNotifications) return;
      if (!isBrowserEnabled(eventType)) return;
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;

      // Prefer service worker for persistent notifications
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          payload: { title, body, data },
        });
      } else {
        new Notification(title, {
          body,
          icon: '/favicon.png',
          tag: 'job-notification',
          data,
        });
      }
    },
    [enableBrowserNotifications, isBrowserEnabled]
  );

  // Stop watching current job
  const stopWatching = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    jobIdRef.current = null;
    setIsConnected(false);
    setStatus(null); // Clear status so toast disappears
    setError(null);
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

          // Respect toast_enabled preference
          const toastEventType: NotificationEventType =
            data.status === 'completed' ? 'model_completed' : 'model_failed';
          const shouldShowToast =
            data.status === 'completed'
              ? isToastEnabled('model_completed')
              : data.status === 'failed'
                ? isToastEnabled('model_failed')
                : true; // always show in-progress status

          if (shouldShowToast || !['completed', 'failed'].includes(data.status)) {
            setStatus(data);
          }

          onStatusChange?.(data);

          // Handle terminal states
          if (data.status === 'completed') {
            showBrowserNotification(
              'model_completed',
              'Model Complete',
              'Your fire model has finished running.',
              { url: `/models/${data.modelId}/results` }
            );
            onComplete?.(data);
          } else if (data.status === 'failed') {
            showBrowserNotification(
              'model_failed',
              'Model Failed',
              data.error || 'An error occurred during execution.',
              { url: `/models/${data.modelId}` }
            );
            onError?.(data);
          }

          // Suppress toast for terminal states when toast is disabled
          if (['completed', 'failed'].includes(data.status) && !shouldShowToast) {
            // Use void to explicitly ignore — status was not set above
            void toastEventType;
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
    [stopWatching, onStatusChange, onComplete, onError, showBrowserNotification, isToastEnabled]
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
