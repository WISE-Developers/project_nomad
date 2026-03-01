/**
 * NotificationPreferences Component — Unit Tests
 *
 * Tests rendering, preference loading, and toggle interactions.
 * The API module is mocked so no network calls are made.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationPreferences } from '../NotificationPreferences.js';
import type { NotificationPreference } from '../../../../services/api.js';

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock('../../../../services/api.js', () => ({
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));

import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../../../../services/api.js';

const mockGetPrefs = vi.mocked(getNotificationPreferences);
const mockUpdatePrefs = vi.mocked(updateNotificationPreferences);

const DEFAULT_PREFS: NotificationPreference[] = [
  { userId: 'user-1', eventType: 'model_completed', toastEnabled: true, browserEnabled: false },
  { userId: 'user-1', eventType: 'model_failed', toastEnabled: true, browserEnabled: false },
  { userId: 'user-1', eventType: 'import_completed', toastEnabled: true, browserEnabled: false },
  { userId: 'user-1', eventType: 'import_failed', toastEnabled: true, browserEnabled: false },
];

// ─── Tests ────────────────────────────────────────────────────────

describe('NotificationPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPrefs.mockResolvedValue({ preferences: DEFAULT_PREFS });
    mockUpdatePrefs.mockResolvedValue({ preferences: DEFAULT_PREFS });
  });

  describe('rendering', () => {
    it('shows loading state initially', () => {
      render(<NotificationPreferences />);
      expect(screen.getByText('Loading preferences...')).toBeInTheDocument();
    });

    it('renders all four event types after loading', async () => {
      render(<NotificationPreferences />);

      await waitFor(() => {
        expect(screen.getByText('Model Completed')).toBeInTheDocument();
      });

      expect(screen.getByText('Model Failed')).toBeInTheDocument();
      expect(screen.getByText('Import Completed')).toBeInTheDocument();
      expect(screen.getByText('Import Failed')).toBeInTheDocument();
    });

    it('renders Toast and Browser column headers', async () => {
      render(<NotificationPreferences />);

      await waitFor(() => {
        expect(screen.getByText('Toast')).toBeInTheDocument();
      });

      expect(screen.getByText('Browser')).toBeInTheDocument();
    });

    it('renders close button when onClose is provided', async () => {
      const onClose = vi.fn();
      render(<NotificationPreferences onClose={onClose} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading preferences...')).not.toBeInTheDocument();
      });

      const closeButton = screen.getByText('×');
      expect(closeButton).toBeInTheDocument();
    });

    it('does not render close button when onClose is not provided', async () => {
      render(<NotificationPreferences />);

      await waitFor(() => {
        expect(screen.queryByText('Loading preferences...')).not.toBeInTheDocument();
      });

      expect(screen.queryByText('×')).not.toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<NotificationPreferences onClose={onClose} />);

      await waitFor(() => {
        expect(screen.queryByText('Loading preferences...')).not.toBeInTheDocument();
      });

      await user.click(screen.getByText('×'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('toggle interaction', () => {
    it('renders toggle switches for each event type', async () => {
      render(<NotificationPreferences />);

      await waitFor(() => {
        expect(screen.getByText('Model Completed')).toBeInTheDocument();
      });

      // 4 event types × 2 channels = 8 toggles
      const toggles = screen.getAllByRole('switch');
      expect(toggles).toHaveLength(8);
    });

    it('calls updateNotificationPreferences when a toggle changes', async () => {
      const user = userEvent.setup();
      render(<NotificationPreferences />);

      await waitFor(() => {
        expect(screen.getByText('Model Completed')).toBeInTheDocument();
      });

      const toastToggle = screen.getByRole('switch', {
        name: 'Toast for Model Completed',
      });

      await act(async () => {
        await user.click(toastToggle);
      });

      expect(mockUpdatePrefs).toHaveBeenCalledOnce();
    });

    it('shows error message when save fails', async () => {
      const user = userEvent.setup();
      mockUpdatePrefs.mockRejectedValue(new Error('Save failed'));

      render(<NotificationPreferences />);

      await waitFor(() => {
        expect(screen.getByText('Model Completed')).toBeInTheDocument();
      });

      const toastToggle = screen.getByRole('switch', {
        name: 'Toast for Model Completed',
      });

      await act(async () => {
        await user.click(toastToggle);
      });

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('shows error when preferences fail to load', async () => {
      mockGetPrefs.mockRejectedValue(new Error('Network error'));

      render(<NotificationPreferences />);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });
});
