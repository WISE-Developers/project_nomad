/**
 * useJobNotifications Hook — Unit Tests
 *
 * Tests preference fetching, SW registration, and notification gating.
 * EventSource and fetch are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useJobNotifications } from '../useJobNotifications.js';

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock('../../../../services/api.js', () => ({
  getNotificationPreferences: vi.fn(),
}));

vi.mock('../../../../services/serviceWorker.js', () => ({
  registerServiceWorker: vi.fn().mockResolvedValue(null),
}));

import { getNotificationPreferences } from '../../../../services/api.js';
import { registerServiceWorker } from '../../../../services/serviceWorker.js';

const mockGetPrefs = vi.mocked(getNotificationPreferences);
const mockRegisterSW = vi.mocked(registerServiceWorker);

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners: Map<string, Array<(event: Event) => void>> = new Map();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: Event) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(handler);
  }

  dispatchMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  dispatchCustomEvent(type: string, data?: unknown): void {
    const handlers = this.listeners.get(type) ?? [];
    const event = { data: data ? JSON.stringify(data) : undefined } as Event;
    for (const handler of handlers) {
      handler(event);
    }
  }

  close(): void {}
}

// ─── Setup / Teardown ─────────────────────────────────────────────

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);

  mockGetPrefs.mockResolvedValue({
    preferences: [
      { userId: '', eventType: 'model_completed', toastEnabled: true, browserEnabled: false },
      { userId: '', eventType: 'model_failed', toastEnabled: true, browserEnabled: false },
      { userId: '', eventType: 'import_completed', toastEnabled: true, browserEnabled: false },
      { userId: '', eventType: 'import_failed', toastEnabled: true, browserEnabled: false },
    ],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────

describe('useJobNotifications', () => {
  describe('initialization', () => {
    it('registers service worker on mount', async () => {
      renderHook(() => useJobNotifications());

      await waitFor(() => {
        expect(mockRegisterSW).toHaveBeenCalledOnce();
      });
    });

    it('fetches notification preferences on mount', async () => {
      renderHook(() => useJobNotifications());

      await waitFor(() => {
        expect(mockGetPrefs).toHaveBeenCalledOnce();
      });
    });

    it('starts with null status and disconnected', () => {
      const { result } = renderHook(() => useJobNotifications());

      expect(result.current.status).toBeNull();
      expect(result.current.isConnected).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('watchJob', () => {
    it('creates an EventSource for the job', async () => {
      const { result } = renderHook(() => useJobNotifications());

      result.current.watchJob('job-123');

      expect(MockEventSource.instances).toHaveLength(1);
      expect(MockEventSource.instances[0].url).toBe('/api/v1/jobs/job-123/stream');
    });

    it('updates status when SSE message arrives', async () => {
      const { result } = renderHook(() => useJobNotifications());

      result.current.watchJob('job-1');
      const es = MockEventSource.instances[0];

      const statusData = {
        id: 'job-1',
        modelId: 'model-1',
        status: 'running',
        progress: 50,
        createdAt: new Date().toISOString(),
      };

      es.onopen?.(new Event('open'));
      es.dispatchMessage(statusData);

      await waitFor(() => {
        expect(result.current.status?.status).toBe('running');
      });
    });

    it('calls onComplete callback when job completes', async () => {
      const onComplete = vi.fn();
      const { result } = renderHook(() => useJobNotifications({ onComplete }));

      result.current.watchJob('job-complete');
      const es = MockEventSource.instances[0];

      const statusData = {
        id: 'job-complete',
        modelId: 'model-1',
        status: 'completed',
        progress: 100,
        createdAt: new Date().toISOString(),
      };

      es.dispatchMessage(statusData);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
      });
    });

    it('calls onError callback when job fails', async () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useJobNotifications({ onError }));

      result.current.watchJob('job-fail');
      const es = MockEventSource.instances[0];

      const statusData = {
        id: 'job-fail',
        modelId: 'model-1',
        status: 'failed',
        progress: 0,
        error: 'Execution error',
        createdAt: new Date().toISOString(),
      };

      es.dispatchMessage(statusData);

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
      });
    });
  });

  describe('stopWatching', () => {
    it('clears status when stopWatching is called', async () => {
      const { result } = renderHook(() => useJobNotifications());

      result.current.watchJob('job-1');
      const es = MockEventSource.instances[0];

      es.dispatchMessage({
        id: 'job-1',
        modelId: 'model-1',
        status: 'running',
        progress: 10,
        createdAt: new Date().toISOString(),
      });

      await waitFor(() => {
        expect(result.current.status).not.toBeNull();
      });

      result.current.stopWatching();

      await waitFor(() => {
        expect(result.current.status).toBeNull();
      });
    });
  });

  describe('preference fetching failure', () => {
    it('falls back to defaults when preferences fetch fails', async () => {
      mockGetPrefs.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useJobNotifications());

      // Hook should still work
      expect(result.current.status).toBeNull();

      await waitFor(() => {
        expect(mockGetPrefs).toHaveBeenCalledOnce();
      });

      // watchJob should still work with defaults
      result.current.watchJob('job-1');
      expect(MockEventSource.instances).toHaveLength(1);
    });
  });
});
