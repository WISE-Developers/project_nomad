/**
 * Splash Screen Component
 *
 * Branded welcome screen shown on app load.
 * Auth mode determines behavior:
 *   'none'   — click anywhere to enter
 *   'simple' — username input field
 *   'oauth'  — OAuth provider buttons (dynamically loaded from backend)
 */

import { useState, useEffect, useCallback } from 'react';
import { version } from '../../package.json';
import { authClient } from '../services/authClient';

type AuthMode = 'none' | 'simple' | 'oauth';

function resolveAuthMode(): AuthMode {
  const mode = import.meta.env.VITE_AUTH_MODE;
  if (mode === 'none' || mode === 'simple' || mode === 'oauth') {
    return mode;
  }
  // Legacy fallback
  if (import.meta.env.VITE_SIMPLE_AUTH !== undefined) {
    console.warn('[Nomad] VITE_SIMPLE_AUTH is deprecated. Use VITE_AUTH_MODE=none|simple|oauth');
    return import.meta.env.VITE_SIMPLE_AUTH === 'true' ? 'simple' : 'none';
  }
  return 'none';
}

const AUTH_MODE = resolveAuthMode();
const STORAGE_KEY = 'nomad_username';

/** Brand colors and labels for each OAuth provider */
const PROVIDER_STYLES: Record<string, { bg: string; border?: string; label: string }> = {
  google:    { bg: '#4285F4', label: 'Google' },
  microsoft: { bg: '#2F2F2F', border: '1px solid #555', label: 'Microsoft' },
  github:    { bg: '#24292e', border: '1px solid #555', label: 'GitHub' },
  apple:     { bg: '#000000', border: '1px solid #555', label: 'Apple' },
  discord:   { bg: '#5865F2', label: 'Discord' },
  facebook:  { bg: '#1877F2', label: 'Facebook' },
  twitter:   { bg: '#1DA1F2', label: 'Twitter/X' },
};

interface ProviderInfo {
  id: string;
  name: string;
}

interface SplashScreenProps {
  onEnter: () => void;
}

export function SplashScreen({ onEnter }: SplashScreenProps) {
  const [username, setUsername] = useState('');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(AUTH_MODE === 'oauth');

  // Load saved username from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setUsername(saved);
    }
  }, []);

  // Check for existing OAuth session and fetch available providers
  useEffect(() => {
    if (AUTH_MODE !== 'oauth') return;

    // Check if user already has a valid session (e.g., returning from OAuth redirect)
    authClient.getSession().then((session) => {
      if (session?.data?.user) {
        // Already authenticated — save username and enter
        const name = session.data.user.name || session.data.user.email || 'OAuth User';
        localStorage.setItem(STORAGE_KEY, name);
        onEnter();
        return;
      }
    }).catch(() => {
      // No session — continue showing login buttons
    });

    fetch(`${window.location.origin}/api/v1/auth/providers`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        setProviders(data.providers ?? []);
        setLoadingProviders(false);
      })
      .catch(() => {
        setLoadingProviders(false);
      });
  }, [onEnter]);

  const handleSubmit = useCallback(() => {
    if (AUTH_MODE === 'simple' && !username.trim()) {
      return;
    }
    if (username.trim()) {
      localStorage.setItem(STORAGE_KEY, username.trim());
    }
    onEnter();
  }, [username, onEnter]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  }, [handleSubmit]);

  const canEnter = AUTH_MODE !== 'simple' || username.trim().length > 0;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100000,
      }}
    >
      {/* Logo */}
      <img
        src="/nomad-logo.png"
        alt="Project Nomad"
        style={{
          width: '200px',
          height: 'auto',
          marginBottom: '32px',
          borderRadius: '24px',
        }}
      />

      {/* Title */}
      <h1
        style={{
          color: '#ffffff',
          fontSize: '48px',
          fontWeight: 700,
          margin: '0 0 8px 0',
          textAlign: 'center',
        }}
      >
        Project Nomad
      </h1>

      {/* Subtitle */}
      <p
        style={{
          color: '#94a3b8',
          fontSize: '20px',
          margin: '0 0 32px 0',
          textAlign: 'center',
        }}
      >
        Fire Modeling System<br />
        v{version} (<a
          href="https://github.com/WISE-Developers/project_nomad/blob/main/CHANGES.md"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#60a5fa', textDecoration: 'underline' }}
        >changes</a>) <br />
        SAN Mode (Stand Alone Nomad)
      </p>

      {/* Username input (when simple auth enabled) */}
      {AUTH_MODE === 'simple' && (
        <div style={{ marginBottom: '24px', width: '280px' }}>
          <label
            htmlFor="username"
            style={{
              display: 'block',
              color: '#94a3b8',
              fontSize: '14px',
              marginBottom: '8px',
            }}
          >
            Enter your name to continue
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Your name"
            autoFocus
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: '16px',
              backgroundColor: '#1e293b',
              border: '2px solid #334155',
              borderRadius: '8px',
              color: '#ffffff',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {/* OAuth provider buttons (dynamically loaded) */}
      {AUTH_MODE === 'oauth' && (
        <div style={{ marginBottom: '16px', width: '280px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ color: '#94a3b8', fontSize: '14px', margin: '0 0 4px 0', textAlign: 'center' }}>
            Sign in to continue
          </p>
          {loadingProviders && (
            <p style={{ color: '#64748b', fontSize: '14px', textAlign: 'center' }}>Loading providers...</p>
          )}
          {!loadingProviders && providers.length === 0 && (
            <p style={{ color: '#ef4444', fontSize: '14px', textAlign: 'center' }}>
              No OAuth providers configured. Check your .env file.
            </p>
          )}
          {providers.map(provider => {
            const style = PROVIDER_STYLES[provider.id] ?? { bg: '#475569', label: provider.name };
            return (
              <button
                key={provider.id}
                onClick={() => authClient.signIn.social({ provider: provider.id as 'google', callbackURL: '/' })}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: '#ffffff',
                  backgroundColor: style.bg,
                  border: style.border ?? 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                Sign in with {style.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Enter button (shown for none and simple modes) */}
      {AUTH_MODE !== 'oauth' && (
        <button
          onClick={handleSubmit}
          disabled={!canEnter}
          style={{
            padding: '14px 48px',
            fontSize: '18px',
            fontWeight: 600,
            color: '#ffffff',
            backgroundColor: canEnter ? '#3b82f6' : '#475569',
            border: 'none',
            borderRadius: '8px',
            cursor: canEnter ? 'pointer' : 'not-allowed',
            transition: 'background-color 0.2s',
          }}
        >
          Enter
        </button>
      )}

      {/* Click anywhere hint when no auth */}
      {AUTH_MODE === 'none' && (
        <div
          style={{
            color: '#64748b',
            fontSize: '14px',
            marginTop: '16px',
            animation: 'pulse 2s infinite',
          }}
        >
          or click anywhere to enter
        </div>
      )}

      {/* Pulse animation */}
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
    </div>
  );
}
