/**
 * Pre-flight failure — issue #351.
 *
 * Shown when the weather check itself could not complete. Submission is blocked
 * rather than allowed through: the check exists to prevent a segfault, so
 * proceeding while its result is unknown would defeat it. The user sees why.
 */

import {
  overlayStyle,
  modalStyle,
  noteStyle,
  codesStyle,
  actionsStyle,
  cancelStyle,
} from './preflightModalStyles.js';

export interface PreflightErrorModalProps {
  message: string;
  onDismiss: () => void;
}

export function PreflightErrorModal({ message, onDismiss }: PreflightErrorModalProps) {
  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Weather check failed">
      <div style={modalStyle}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Nomad could not check this weather file</h2>

        <p style={noteStyle}>
          The model was not started. Nothing was created, so nothing needs cleaning up.
        </p>

        <div style={{ ...codesStyle, fontWeight: 400, fontSize: '0.9rem', textAlign: 'left' }}>
          {message}
        </div>

        <p style={noteStyle}>
          Fix the file and try again, or choose a different weather source.
        </p>

        <div style={actionsStyle}>
          <button type="button" style={cancelStyle} onClick={onDismiss}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
