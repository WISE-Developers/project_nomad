/**
 * ContentSplashGate tests (#275)
 *
 * The gate is the wiring between useSplash() and <SplashModal />.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ContentSplashGate } from './ContentSplashGate';

function mockFetch(payload: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(payload),
  });
}

describe('ContentSplashGate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when splash disabled', async () => {
    vi.stubGlobal('fetch', mockFetch({ enabled: false }));
    const { container } = render(<ContentSplashGate />);
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).toBeNull());
  });

  it('renders SplashModal when enabled', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        enabled: true,
        version: '1.0.0',
        title: 'Welcome to Nomad',
        body: 'body text',
        dismissable: true,
      }),
    );
    render(<ContentSplashGate />);
    await waitFor(() =>
      expect(screen.getByText('Welcome to Nomad')).toBeInTheDocument(),
    );
  });

  it('dismiss button closes the modal for the current load', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        enabled: true,
        version: '4.2.0',
        title: 'T',
        body: 'b',
        dismissable: true,
      }),
    );
    render(<ContentSplashGate />);
    const btn = await screen.findByRole('button', { name: /got it/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /got it/i })).toBeNull(),
    );
  });
});
