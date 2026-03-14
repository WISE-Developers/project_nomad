/**
 * SettingsModal
 *
 * Application settings UI. Currently manages the CFS FireSTARR WMS API key.
 * Values stored via /api/v1/settings/:key (DB overrides env var).
 */

import React, { useState, useEffect } from 'react';
import { authClient } from '../../services/authClient';

type AuthMode = 'none' | 'simple' | 'oauth';
function getAuthMode(): AuthMode {
  const mode = import.meta.env.VITE_AUTH_MODE;
  if (mode === 'none' || mode === 'simple' || mode === 'oauth') return mode;
  if (import.meta.env.VITE_SIMPLE_AUTH === 'true') return 'simple';
  return 'none';
}

interface SettingsModalProps {
  onClose: () => void;
}

const CFS_KEY = 'CFS_FIRESTARR_AUTHKEY';

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 20000,
};

const modalStyle: React.CSSProperties = {
  backgroundColor: '#1f2937',
  color: 'white',
  borderRadius: '8px',
  padding: '24px',
  minWidth: '400px',
  maxWidth: '560px',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
};

const headerStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  marginBottom: '20px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: '20px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: '#9ca3af',
  marginBottom: '6px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  backgroundColor: '#374151',
  border: '1px solid #4b5563',
  borderRadius: '6px',
  color: 'white',
  fontSize: '14px',
  fontFamily: 'monospace',
  boxSizing: 'border-box' as const,
};

const hintStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  marginTop: '6px',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  marginTop: '24px',
};

const buttonBaseStyle: React.CSSProperties = {
  padding: '9px 20px',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
};

const saveBtnStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: '#2563eb',
  color: 'white',
};

const cancelBtnStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: '#374151',
  color: '#d1d5db',
};

const statusStyle = (ok: boolean): React.CSSProperties => ({
  fontSize: '13px',
  color: ok ? '#34d399' : '#f87171',
  marginTop: '8px',
});

/**
 * SettingsModal — manages app-level settings.
 */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ message: string; ok: boolean } | null>(null);

  // Load existing value on mount
  useEffect(() => {
    fetch(`/api/v1/settings/${CFS_KEY}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.value) {
          setApiKey(data.value);
        }
      })
      .catch(() => {
        // No existing key — leave blank
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);

    try {
      const response = await fetch(`/api/v1/settings/${CFS_KEY}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: apiKey }),
      });

      if (response.ok) {
        setStatus({ message: 'API key saved successfully.', ok: true });
        setTimeout(onClose, 800);
      } else {
        setStatus({ message: 'Failed to save API key.', ok: false });
      }
    } catch {
      setStatus({ message: 'Network error — could not save.', ok: false });
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <i className="fa-solid fa-gear" />
          Settings
        </div>

        <div style={sectionStyle}>
          <label style={labelStyle}>CFS FireSTARR API Key</label>
          <input
            type="password"
            style={inputStyle}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter API key"
            autoComplete="off"
            spellCheck={false}
          />
          <div style={hintStyle}>
            Required to display CFS FireSTARR WMS layers on the map.
            Contact CFS for a valid authkey.
          </div>
          {status && (
            <div style={statusStyle(status.ok)}>{status.message}</div>
          )}
        </div>

        {/* Logout (OAuth mode only) */}
        {getAuthMode() === 'oauth' && (
          <div style={{ ...sectionStyle, borderTop: '1px solid #374151', paddingTop: '16px' }}>
            <label style={labelStyle}>Session</label>
            <button
              style={{
                ...buttonBaseStyle,
                backgroundColor: '#dc2626',
                color: 'white',
                width: '100%',
              }}
              onClick={async () => {
                await authClient.signOut({ fetchOptions: { credentials: 'include' } });
                localStorage.removeItem('nomad_username');
                // Also revoke the OAuth token server-side
                try {
                  await fetch(`${window.location.origin}/api/auth/revoke`, {
                    method: 'POST',
                    credentials: 'include',
                  });
                } catch {
                  // Best effort — revocation endpoint may not exist
                }
                window.location.href = '/';
              }}
            >
              Sign Out
            </button>
            <div style={hintStyle}>
              Ends your OAuth session and returns to the login screen.
            </div>
          </div>
        )}

        <div style={footerStyle}>
          <button style={cancelBtnStyle} onClick={onClose}>
            Cancel
          </button>
          <button style={saveBtnStyle} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
