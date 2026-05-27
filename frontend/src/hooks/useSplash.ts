/**
 * useSplash hook (#275)
 *
 * Fetches /api/v1/splash on mount, decides whether the content splash
 * should be shown based on the response + acknowledged-version state in
 * localStorage, and exposes a dismiss() that records the current version.
 *
 * Fail-closed: any network/server error → not visible. Splash must never
 * block the app from loading.
 */

import { useCallback, useEffect, useState } from 'react';

export const SPLASH_LAST_ACKED_KEY = 'splash:lastAckedVersion';
export const SPLASH_ENDPOINT = '/api/v1/splash';

export interface SplashContent {
  version: string;
  title: string;
  body: string;
  dismissable: boolean;
}

interface SplashResponse {
  enabled: boolean;
  version?: string;
  title?: string;
  body?: string;
  dismissable?: boolean;
}

export interface UseSplashResult {
  loading: boolean;
  visible: boolean;
  content: SplashContent | null;
  dismiss: () => void;
}

export function useSplash(): UseSplashResult {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<SplashContent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch(SPLASH_ENDPOINT);
        if (!resp.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data: SplashResponse = await resp.json();
        if (cancelled) return;
        if (!data.enabled || !data.version || !data.title || data.body === undefined) {
          setLoading(false);
          return;
        }
        setContent({
          version: data.version,
          title: data.title,
          body: data.body,
          dismissable: data.dismissable !== false,
        });
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (content) {
      try {
        localStorage.setItem(SPLASH_LAST_ACKED_KEY, content.version);
      } catch {
        // localStorage may be unavailable (private mode / SSR); no-op
      }
    }
    setDismissed(true);
  }, [content]);

  let alreadyAcked = false;
  if (content) {
    try {
      alreadyAcked = localStorage.getItem(SPLASH_LAST_ACKED_KEY) === content.version;
    } catch {
      alreadyAcked = false;
    }
  }

  const visible = !loading && !dismissed && content !== null && !alreadyAcked;

  return { loading, visible, content, dismiss };
}
