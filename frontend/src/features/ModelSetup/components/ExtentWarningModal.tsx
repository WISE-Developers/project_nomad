/**
 * Large-fire advisory — issue #432.
 *
 * Shown before the run starts, which is the whole point: Franco's instruction
 * was "before they hit run", because once a run is under way the choice of
 * whether to split the fire into separate models has already been made for the
 * operator.
 *
 * DELIBERATELY NOT AN ERROR. A 200 km fire is legal and will simulate
 * correctly. The operator is being told where the cliff is — beyond a 409.6 km
 * square FireSTARR quietly crops the domain and reports nothing about what it
 * left out — while they can still act on it. The primary action is therefore
 * "Run it", not a dismissal: the default must not be to abandon work that is
 * perfectly valid.
 *
 * The refusal case has its own path and never reaches this component. A warning
 * carrying an acknowledge button for a run that cannot proceed would invite the
 * operator to press on into a silently cropped simulation.
 */

import {
  overlayStyle,
  modalStyle,
  noteStyle,
  codesStyle,
  actionsStyle,
  confirmStyle,
  cancelStyle,
} from './preflightModalStyles.js';

export interface ExtentWarningModalProps {
  /** Operator-facing text from the backend, which owns the measurement. */
  message: string;
  onProceed: () => void | Promise<void>;
  onCancel: () => void;
}

export function ExtentWarningModal({ message, onProceed, onCancel }: ExtentWarningModalProps) {
  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Large fire">
      <div style={modalStyle}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>This is a large fire</h2>

        <div style={{ ...codesStyle, fontWeight: 400, fontSize: '0.9rem', textAlign: 'left' }}>
          {message}
        </div>

        <p style={noteStyle}>
          Nothing has been created yet. You can go back and redraw, or run it as it is.
        </p>

        <div style={actionsStyle}>
          <button type="button" style={cancelStyle} onClick={onCancel}>
            Go back
          </button>
          <button type="button" style={confirmStyle} onClick={() => void onProceed()}>
            Run it
          </button>
        </div>
      </div>
    </div>
  );
}
