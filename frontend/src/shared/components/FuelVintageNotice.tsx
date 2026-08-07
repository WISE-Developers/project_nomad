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

interface FuelVintageNoticeProps {
  /** Resolution from GET /api/v1/fuel-datasets?modelYear=. */
  resolved: ResolvedFuelDataset | undefined;
  /** Optional label override, e.g. 'Fuel vintage used' in results. */
  label?: string;
}

const SURFACE = '#ffffff';

const containerStyle: React.CSSProperties = {
  backgroundColor: SURFACE,
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
}) => {
  // Nothing resolved yet — render nothing rather than an empty or guessed value.
  if (!resolved) {
    return null;
  }

  const { vintageLabel, severity, warning } = describeFuelVintage(resolved);

  return (
    <div style={containerStyle} data-testid="fuel-vintage-notice">
      <div style={valueRowStyle}>
        <span style={labelStyle}>{label}:</span>{' '}
        <span style={valueStyle} data-testid="fuel-vintage-value">{vintageLabel}</span>
        {resolved.dataset?.producer && (
          <span style={producerStyle}> ({resolved.dataset.producer})</span>
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
