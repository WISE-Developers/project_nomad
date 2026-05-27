/**
 * useSplash hook (#275)
 *
 * Fetches /api/v1/splash on mount and exposes the content + a dismiss()
 * that closes the modal for the current page load only.
 *
 * No persistence by design — splash re-appears on every load when
 * enabled. Operators control content via the markdown file; nothing on
 * the client side suppresses it.
 *
 * Fail-closed: any network/server error → not visible. Splash must never
 * block the app from loading.
 */

import { useCallback, useEffect, useState } from 'react';

export const SPLASH_ENDPOINT = '/api/v1/splash';

export interface SplashContent {
  title: string;
  body: string;
  dismissable: boolean;
}

interface SplashResponse {
  enabled: boolean;
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
        if (!data.enabled || !data.title || data.body === undefined) {
          setLoading(false);
          return;
        }
        setContent({
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
    setDismissed(true);
  }, []);

  const visible = !loading && !dismissed && content !== null;

  return { loading, visible, content, dismiss };
}
