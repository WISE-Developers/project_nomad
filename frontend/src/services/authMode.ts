/**
 * The server is the authority on the auth mode (#474).
 *
 * It used to be `import.meta.env.VITE_AUTH_MODE`, which Vite inlines at BUILD
 * time. That held for as long as every host built its own image from its own
 * `.env`. Once CI published ONE image for every site (#465), the baked constant
 * carried the CI default — `simple` — to the CIFFC demo, whose backend runs
 * `oauth`: the splash offered "Enter your name to continue" while the server
 * had Google and GitHub initialised. Runtime environment cannot change a
 * compiled bundle, so the client asks.
 *
 * There is deliberately NO baked default to fall back on. Guessing is exactly
 * what shipped the wrong login screen; a client that cannot reach its own API
 * must say so rather than render a plausible form that posts nowhere.
 */

export type AuthMode = 'none' | 'simple' | 'oauth';

let inFlight: Promise<AuthMode> | null = null;

/** Resolved once per page load and shared — the mode cannot change under us. */
export function fetchAuthMode(): Promise<AuthMode> {
  if (!inFlight) {
    inFlight = (async () => {
      const res = await fetch(`${window.location.origin}/api/v1/info`, { credentials: 'include' });
      if (!res.ok) throw new Error(`/api/v1/info returned ${res.status}`);
      const info = await res.json();
      const mode = info?.authMode;
      if (mode === 'none' || mode === 'simple' || mode === 'oauth') return mode as AuthMode;
      throw new Error(`/api/v1/info reported no usable authMode (got ${JSON.stringify(mode)})`);
    })().catch((err) => {
      // A failed lookup must not poison every later attempt.
      inFlight = null;
      throw err;
    });
  }
  return inFlight;
}

/** Tests only: forget the cached lookup. */
export function resetAuthModeCache(): void {
  inFlight = null;
}
