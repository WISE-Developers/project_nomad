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
 */

import React from 'react';
import { describeFuelVintage, type ResolvedFuelDataset } from '../utils/fuelVintage';

interface FuelVintageNoticeProps {
  /** Resolution from GET /api/v1/fuel-datasets?modelYear=. */
  resolved: ResolvedFuelDataset | undefined;
  /** Optional label override, e.g. 'Fuel data' vs 'Fuel vintage'. */
  label?: string;
}

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
    <div className="fuel-vintage-notice">
      <div className="fuel-vintage-notice__value">
        <span className="fuel-vintage-notice__label">{label}:</span>{' '}
        <span data-testid="fuel-vintage-value">{vintageLabel}</span>
        {resolved.dataset?.producer && (
          <span className="fuel-vintage-notice__producer"> ({resolved.dataset.producer})</span>
        )}
      </div>

      {severity === 'warning' && warning && (
        // role="status" + aria-live="polite": advisory, announced without
        // interrupting. An alert would overstate it.
        <div className="fuel-vintage-notice__warning" role="status" aria-live="polite">
          {warning}
        </div>
      )}
    </div>
  );
};

export default FuelVintageNotice;
