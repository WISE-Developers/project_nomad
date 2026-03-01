/**
 * Tests for SettingsModal component
 *
 * Verifies CFS API key input renders and saves on submit.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from '../SettingsModal.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: GET returns 404 (no key set)
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
    });
  });

  it('renders CFS API key input', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    // Should have a label or heading for CFS API key
    expect(screen.getByText(/CFS.*API.*[Kk]ey|CFS FireSTARR Auth/i)).toBeInTheDocument();

    // Should have a password/text input for the key
    const input = screen.getByPlaceholderText(/enter.*key|api.*key|authkey/i);
    expect(input).toBeInTheDocument();
  });

  it('saves key on submit', async () => {
    const user = userEvent.setup();

    // Mock PUT to succeed
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: 'CFS_FIRESTARR_AUTHKEY', value: 'test-key' }),
    });

    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);

    const input = screen.getByPlaceholderText(/enter.*key|api.*key|authkey/i);
    await user.type(input, 'my-test-api-key');

    const saveBtn = screen.getByRole('button', { name: /save/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/settings/CFS_FIRESTARR_AUTHKEY'),
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('my-test-api-key'),
        })
      );
    });
  });

  it('has a cancel button that calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);

    const cancelBtn = screen.getByRole('button', { name: /cancel|close/i });
    await user.click(cancelBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it('masks the API key input', () => {
    render(<SettingsModal onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText(/enter.*key|api.*key|authkey/i);
    expect(input).toHaveAttribute('type', 'password');
  });
});
