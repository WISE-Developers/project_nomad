/**
 * THE SERVER DECIDES THE AUTH MODE, NOT THE BUNDLE (#474).
 *
 * THE BUG, in production on 2026-10-25. SplashScreen read
 * `import.meta.env.VITE_AUTH_MODE`, which Vite inlines at BUILD time. Once CI
 * published one image for every site (#465), that constant carried the CI
 * default — `simple` — to the CIFFC demo, whose backend runs `oauth`. Users got
 * "Enter your name to continue" while the server had Google and GitHub
 * initialised. Runtime environment cannot change a compiled bundle.
 *
 * So these tests pin the inverse of the defect: with the baked constant saying
 * one thing and the SERVER saying another, the server wins.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SplashScreen } from './SplashScreen';
import { resetAuthModeCache } from '../services/authMode';

function mockServer(authMode: string, providers: Array<{ id: string; name: string }> = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/info')) {
        return Promise.resolve(new Response(JSON.stringify({ name: 'Project Nomad', authMode })));
      }
      if (url.includes('/api/v1/auth/providers')) {
        return Promise.resolve(new Response(JSON.stringify({ providers })));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
}

describe('SplashScreen auth mode comes from the server (#474)', () => {
  beforeEach(() => {
    localStorage.clear();
    // The lookup is cached per page load, so each test must start clean or it
    // asserts against the previous test's server.
    resetAuthModeCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders OAuth sign-in when the SERVER says oauth', async () => {
    mockServer('oauth', [{ id: 'google', name: 'Google' }]);
    render(<SplashScreen onEnter={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Sign in with Google/i)).toBeInTheDocument();
    });
    // The defect rendered this instead.
    expect(screen.queryByText(/Enter your name to continue/i)).not.toBeInTheDocument();
  });

  it('renders the name field when the SERVER says simple', async () => {
    mockServer('simple');
    render(<SplashScreen onEnter={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Enter your name to continue/i)).toBeInTheDocument();
    });
  });

  it('asks the server rather than trusting the bundle', async () => {
    mockServer('oauth', [{ id: 'google', name: 'Google' }]);
    render(<SplashScreen onEnter={() => {}} />);
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      expect(calls.some((c) => String(c[0]).includes('/api/v1/info'))).toBe(true);
    });
  });
});
