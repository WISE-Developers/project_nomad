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

export interface DailyRhythm {
  dailyHour: number;
  hoursFromNoon: number;
  likelyZoneMismatch: boolean;
}

export interface StartingCodesModalProps {
  /** The reading recovered from the file, or null when none precedes ignition. */
  candidate: StartingCodeCandidate | null;
  /** How the file's rhythm compares with the contract (#354). */
  rhythm?: DailyRhythm | null;
  /** The model's declared IANA zone, named back to the user. */
  timezone?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The declared zone's offset from UTC, in hours, right now. */
function zoneOffsetHours(timeZone: string): number | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, timeZoneName: 'longOffset' });
    const name = formatter.formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
    if (!match) return 0; // "GMT" with no suffix is UTC itself
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) + Number(match[3]) / 60);
  } catch {
    return null;
  }
}

/** Two decimals, so 424.9 reads as 424.90 alongside the others. */
function code(value: number): string {
  return value.toFixed(2);
}

/**
 * Explains a rhythm that does not sit at local noon.
 *
 * The contract (#354) is that the Date column is local time in the model's
 * timezone, and daily codes are recorded at noon. When the file's readings land
 * elsewhere, the gap IS the offset — and if it matches the declared zone's own
 * offset from UTC, the file is almost certainly UTC.
 */
function zoneNote(rhythm: DailyRhythm, timezone?: string): string {
  const hours = Math.abs(rhythm.hoursFromNoon);
  const direction = rhythm.hoursFromNoon > 0 ? 'ahead of' : 'behind';
  const zone = timezone ?? 'the selected timezone';
  const hourLabel = `${String(rhythm.dailyHour).padStart(2, '0')}:00`;

  const offset = timezone ? zoneOffsetHours(timezone) : null;
  const looksLikeUtc = offset !== null && Math.abs(rhythm.hoursFromNoon + offset) < 0.5;

  const base =
    `Its daily readings sit at ${hourLabel} in ${zone}, but daily codes are recorded at noon — ` +
    `${hours} hours ${direction} the timezone this model declares.`;

  return looksLikeUtc
    ? `${base} That gap matches ${zone}'s offset exactly, so these timestamps are most likely UTC. ` +
      `If they are, set the model timezone to UTC before running.`
    : `${base} Check that the model timezone matches the clock your station records in.`;
}

export function StartingCodesModal({
  candidate,
  rhythm,
  timezone,
  onConfirm,
  onCancel,
}: StartingCodesModalProps) {
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

        {rhythm?.likelyZoneMismatch && (
          <p style={{ ...noteStyle, color: '#fbbf24' }}>
            {zoneNote(rhythm, timezone)}
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
