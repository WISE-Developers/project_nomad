/**
 * Starting-codes confirmation — issue #351.
 *
 * A weather file with CFFDRS values on daily rows only satisfies neither
 * supported contract, and uploading it segfaults the engine. But the user
 * already has what Nomad needs: the noon reading is in the file. This states
 * what was found, in real numbers, and asks.
 *
 * Styling follows the house pattern (see AboutModal) — inline style objects as
 * module-level consts. There is no shared dialog primitive in this codebase;
 * every modal hand-rolls its own overlay.
 */

import type { StartingCodeCandidate } from '../utils/weatherPreflight.js';
import {
  overlayStyle,
  modalStyle,
  codesStyle,
  noteStyle,
  actionsStyle,
  confirmStyle,
  cancelStyle,
} from './preflightModalStyles.js';

export interface StartingCodesModalProps {
  /** The reading recovered from the file, or null when none precedes ignition. */
  candidate: StartingCodeCandidate | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Two decimals, so 424.9 reads as 424.90 alongside the others. */
function code(value: number): string {
  return value.toFixed(2);
}

export function StartingCodesModal({ candidate, onConfirm, onCancel }: StartingCodesModalProps) {
  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Starting codes">
      <div style={modalStyle}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>This weather file records its indices once a day</h2>

        <p style={noteStyle}>
          Nomad accepts two shapes: a FireSTARR file with hourly CFFDRS values on{' '}
          <strong>every</strong> row, or raw observations plus starting codes. Yours records the
          indices on the daily reading only, so the remaining hours have no values.
        </p>

        {candidate ? (
          <>
            <div style={codesStyle}>
              Nomad found starting codes in your file:
              <br />
              FFMC {code(candidate.ffmc)}, DMC {code(candidate.dmc)}, DC {code(candidate.dc)}
              <br />
              from {candidate.localLabel}
            </div>

            <p style={noteStyle}>
              This is the last daily reading before your ignition time. Use these as the starting
              codes and Nomad will calculate the remaining hours from your observations.
            </p>
          </>
        ) : (
          <p style={noteStyle}>
            Nomad could not offer starting codes: this file has no daily reading{' '}
            <strong>before</strong> your ignition time. Choose an ignition time covered by the file,
            or upload raw observations with the starting codes you want to use.
          </p>
        )}

        <div style={actionsStyle}>
          <button type="button" style={cancelStyle} onClick={onCancel}>
            Cancel
          </button>
          {candidate && (
            <button type="button" style={confirmStyle} onClick={onConfirm}>
              Use these codes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
