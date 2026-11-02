/**
 * THE PROVIDERS FETCH MUST NOT SET STATE AFTER UNMOUNT (#505).
 *
 * THE BUG. `Frontend on React 19` failed on PR #504 with 98 files and 806 tests
 * all passing, on a single unhandled rejection:
 *
 *   ReferenceError: window is not defined
 *    ❯ resolveUpdatePriority react-dom-client.development.js:1498
 *    ❯ dispatchSetState      react-dom-client.development.js:9512
 *    ❯ src/components/SplashScreen.tsx:104
 *
 * SplashScreen's OAuth effect started a providers fetch and called
 * setLoadingProviders / setProviders in its continuations with no cancellation
 * guard and no cleanup. When the promise settled after the component had gone,
 * React reached for `window` in a torn-down jsdom.
 *
 * WHY IT WAS A RANDOM CI FAILURE RATHER THAN A TEST FAILURE. It depends on
 * whether the promise settles before or after teardown, so the SAME commit
 * (70f9c104) produced a failure and a success in two runs. A rare flake lands on
 * whoever is merging something unrelated.
 *
 * WHAT THIS TEST PINS. It makes the race deterministic -- the fetch is held
 * open, the component is unmounted, and only then does the promise settle -- and
 * asserts React is never asked to update the gone component. The correct pattern
 * was already one effect above, at SplashScreen.tsx:62.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SplashScreen } from './SplashScreen';
import { resetAuthModeCache } from '../services/authMode';

describe('SplashScreen does not set state after unmount (#505)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetAuthModeCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('settles the providers fetch after unmount without updating the component', async () => {
    // Held open deliberately: this is the window in which the real failure happens.
    let releaseProviders!: (value: Response) => void;
    const providersInFlight = new Promise<Response>((resolve) => {
      releaseProviders = resolve;
    });

    let providersRequested = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/v1/info')) {
          return Promise.resolve(
            new Response(JSON.stringify({ name: 'Project Nomad', authMode: 'oauth' })),
          );
        }
        if (url.includes('/api/v1/auth/providers')) {
          providersRequested = true;
          return providersInFlight;
        }
        return Promise.resolve(new Response('{}', { status: 404 }));
      }),
    );

    const { unmount } = render(<SplashScreen onEnter={() => {}} />);

    // The effect under test only runs once the server has said "oauth", so
    // waiting for the request is what proves we are actually in the race.
    await waitFor(() => {
      expect(providersRequested).toBe(true);
    });

    // THE INSTRUMENT. React 19 drops updates to an unmounted component
    // SILENTLY -- no act warning, no console.error -- so asserting on console
    // output produces a test that passes against the defect. (It did: that was
    // the first version of this test, and it was worthless.)
    //
    // The real failure needs the ENVIRONMENT to be gone, which is what happens
    // at vitest teardown. So reproduce that: take `window` away before the
    // promise settles. An unguarded setter reaches react-dom's
    // resolveUpdatePriority, which reads `window.event`, and throws inside the
    // component's own promise chain -- surfacing as an unhandled rejection,
    // exactly as it did in CI.
    const rejections: unknown[] = [];
    const onRejection = (err: unknown) => { rejections.push(err); };
    process.on('unhandledRejection', onRejection);

    const realWindow = globalThis.window;
    unmount();
    // @ts-expect-error -- deliberately simulating teardown
    delete (globalThis as { window?: unknown }).window;

    releaseProviders(new Response(JSON.stringify({ providers: [{ id: 'google', name: 'Google' }] })));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    (globalThis as { window?: unknown }).window = realWindow;
    process.off('unhandledRejection', onRejection);

    const messages = rejections.map((r) => (r instanceof Error ? r.message : String(r)));
    expect(messages).toEqual([]);
  });
});
