/**
 * ContentSplashGate (#275)
 *
 * Thin wiring component. Pulls splash state from useSplash() and
 * renders the SplashModal when appropriate. Mount once near the app
 * root, after the auth/name gate.
 */

import React from 'react';
import { useSplash } from '../hooks/useSplash';
import { SplashModal } from './SplashModal';

export function ContentSplashGate(): React.ReactElement | null {
  const { visible, content, dismiss } = useSplash();
  if (!visible || !content) return null;
  return (
    <SplashModal
      title={content.title}
      body={content.body}
      onDismiss={dismiss}
    />
  );
}
