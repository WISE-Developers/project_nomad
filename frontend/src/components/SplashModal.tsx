/**
 * SplashModal (#275)
 *
 * Renders the configurable content splash. Markdown body is rendered
 * via react-markdown, which ignores raw HTML by default — safe.
 *
 * Stateless: parent owns visibility.
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { version } from '../../package.json';
import './SplashModal.css';

const RELEASE_URL = `https://github.com/WISE-Developers/project_nomad/releases/tag/v${version}`;

const RELEASE_DATE_DISPLAY = (() => {
  // __RELEASE_DATE__ is a Vite-injected define; undefined in raw test envs.
  const raw = typeof __RELEASE_DATE__ !== 'undefined' ? __RELEASE_DATE__ : '';
  if (!raw) return '';
  try {
    return new Date(raw).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
})();

export interface SplashModalProps {
  title: string;
  body: string;
  onDismiss: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 20000,
};

const modalStyle: React.CSSProperties = {
  backgroundColor: '#1f2937',
  color: '#f9fafb',
  borderRadius: '12px',
  padding: '32px',
  maxWidth: '640px',
  width: '90%',
  maxHeight: '85vh',
  overflowY: 'auto',
  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)',
};

const buttonStyle: React.CSSProperties = {
  marginTop: '24px',
  padding: '10px 24px',
  backgroundColor: '#ff6b35',
  color: 'white',
  border: 'none',
  borderRadius: '8px',
  fontWeight: 'bold',
  cursor: 'pointer',
  fontSize: '15px',
};

export function SplashModal({ title, body, onDismiss }: SplashModalProps): React.ReactElement {
  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label={title}>
      <div style={modalStyle}>
        <h1 className="splash-modal-title">{title}</h1>
        <div className="splash-modal-body">
          <ReactMarkdown>{body}</ReactMarkdown>
        </div>
        <div className="splash-modal-meta">
          v{version}
          {RELEASE_DATE_DISPLAY ? ` · ${RELEASE_DATE_DISPLAY}` : ''}
          {' · '}
          <a href={RELEASE_URL} target="_blank" rel="noopener noreferrer">
            view release
          </a>
        </div>
        <button type="button" style={buttonStyle} onClick={onDismiss}>
          Got it
        </button>
      </div>
    </div>
  );
}
