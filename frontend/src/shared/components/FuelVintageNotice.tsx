/**
 * Shows which fuel dataset vintage a model run uses, and warns — advisory only —
 * when it does not match the modelled year (#319).
 *
 * Shown in model setup and in results. The vintage is displayed whether or not
 * anything is wrong: knowing which fuel produced a result matters even when it
 * is the expected one.
 *
 * The warning never blocks a run. Modelling an old fire on newer fuel is a
 * legitimate thing to do on purpose; this only makes sure it is never done by
 * accident.
 *
 * Styling is inline, matching ModelSummary/ResultsSummary. An earlier cut used
 * className hooks with no stylesheet behind them, so the text inherited the
 * parent's muted colour and rendered too light to read — a fuel-provenance
 * warning nobody can read is worse than no warning. Colours are contrast-checked
 * in FuelVintageNotice.contrast.test.tsx.
 */

import React from 'react';
import { describeFuelVintage, type ResolvedFuelDataset } from '../utils/fuelVintage';
import { deriveFuelYears } from '../utils/fuelYears';

interface FuelVintageNoticeProps {
  /** Resolution from GET /api/v1/fuel-datasets?modelYear=. */
  resolved: ResolvedFuelDataset | undefined;
  /** Optional label override for the vintage row, e.g. 'Fuel vintage used'. */
  label?: string;
  /**
   * The surface this notice is placed on. The component still declares a
   * background explicitly — inheriting is what made the warning unreadable in
   * #319 — but it does not own the colour, because its two call sites differ:
   * ResultsSummary sits on white, ModelSummary's card is '#f8f9fa'. Hard-coding
   * white rendered a white block inset inside the grey card (#431).
   */
  surface?: string;
}

const DEFAULT_SURFACE = '#ffffff';

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const valueRowStyle: React.CSSProperties = {
  fontSize: '13px',
};

const labelStyle: React.CSSProperties = {
  color: '#555555',
};

const valueStyle: React.CSSProperties = {
  fontWeight: 500,
  color: '#1f1f1f',
};

const producerStyle: React.CSSProperties = {
  color: '#555555',
};

// Amber, not red: this is advisory, not an error. #7a4a00 on #fff8e1 clears
// WCAG AA for body text while still reading as a caution.
const warningStyle: React.CSSProperties = {
  fontSize: '13px',
  lineHeight: 1.45,
  color: '#7a4a00',
  backgroundColor: '#fff8e1',
  border: '1px solid #ffe0a3',
  borderRadius: '4px',
  padding: '8px 10px',
};

export const FuelVintageNotice: React.FC<FuelVintageNoticeProps> = ({
  resolved,
  label = 'Fuel vintage',
  surface = DEFAULT_SURFACE,
}) => {
  // Nothing resolved yet — render nothing rather than an empty or guessed value.
  if (!resolved) {
    return null;
  }

  const { severity, warning } = describeFuelVintage(resolved);
  const { modelYear, datasetYear, fuelVintage } = deriveFuelYears(resolved);

  // Both numbers, each labelled. Showing one and calling it the other is the
  // defect #431 fixed: an analyst reading "Fuel vintage: 2026" believes in fuel
  // that cannot exist yet, and nothing on screen says which year is meant.
  return (
    <div style={{ ...containerStyle, backgroundColor: surface }} data-testid="fuel-vintage-notice">
      <div style={valueRowStyle}>
        <span style={labelStyle}>Model year:</span>{' '}
        <span style={valueStyle} data-testid="model-year-value">
          {modelYear ?? 'not recorded'}
        </span>
      </div>

      <div style={valueRowStyle}>
        <span style={labelStyle}>{label}:</span>{' '}
        <span style={valueStyle} data-testid="fuel-vintage-value">
          {fuelVintage ?? 'not recorded'}
        </span>
        {datasetYear !== undefined && (
          // Name the dataset the vintage came from, so the -1 is visible rather
          // than looking like an error to anyone who knows the directory names.
          <span style={producerStyle}> (start-of-{datasetYear} fuel state)</span>
        )}
        {resolved.dataset?.producer && (
          // Square brackets, not a second parenthesis: "(start-of-2023 fuel
          // state) (Jordan Evens)" stacked two parenthetical groups back to
          // back and read as clutter (#431).
          <span style={producerStyle}> [{resolved.dataset.producer}]</span>
        )}
      </div>

      {severity === 'warning' && warning && (
        // role="status" + aria-live="polite": advisory, announced without
        // interrupting. An alert would overstate it.
        <div style={warningStyle} role="status" aria-live="polite">
          {warning}
        </div>
      )}
    </div>
  );
};

export default FuelVintageNotice;
