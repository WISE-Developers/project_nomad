/**
 * Shared styling for the pre-flight dialogs — issue #351.
 *
 * Follows the house pattern (see AboutModal): inline style objects as
 * module-level consts. There is no shared dialog primitive in this codebase;
 * every modal hand-rolls its own overlay, so these are shared between the two
 * pre-flight dialogs rather than duplicated.
 */

import type React from 'react';

export const overlayStyle: React.CSSProperties = {
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

export const modalStyle: React.CSSProperties = {
  backgroundColor: '#1f2937',
  color: 'white',
  borderRadius: '12px',
  padding: '32px',
  width: 'calc(100% - 32px)',
  maxWidth: '520px',
  boxSizing: 'border-box',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
};

export const codesStyle: React.CSSProperties = {
  backgroundColor: '#111827',
  borderRadius: '8px',
  padding: '16px',
  margin: '16px 0',
  fontSize: '1.05rem',
  fontWeight: 600,
  textAlign: 'center',
};

export const noteStyle: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#9ca3af',
  lineHeight: 1.5,
};

export const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  justifyContent: 'flex-end',
  marginTop: '24px',
  flexWrap: 'wrap',
};

export const buttonStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '8px',
  border: 'none',
  cursor: 'pointer',
  fontSize: '0.95rem',
};

export const confirmStyle: React.CSSProperties = {
  ...buttonStyle,
  backgroundColor: '#2563eb',
  color: 'white',
  fontWeight: 600,
};

export const cancelStyle: React.CSSProperties = {
  ...buttonStyle,
  backgroundColor: 'transparent',
  color: '#d1d5db',
  border: '1px solid #4b5563',
};

