/**
 * The notice must sit in its panel's row idiom (#431).
 *
 * In model setup every row is `display: flex; justify-content: space-between`
 * (ModelSummary rowStyle) — label left, value hard right against the card
 * edge. The notice rendered label-then-value inline, so the Fuel Data card was
 * the only block in the panel whose values did not line up with the rest.
 *
 * The notice already shares that panel's 13px size and #555 label colour, so
 * the spread is the only thing missing.
 *
 * `inline` stays the DEFAULT on purpose. The results panel is internally
 * mixed — Output Configuration stacks a 12px label above a 16px value, Model
 * Inputs puts text left and a button right — so there is no single idiom to
 * match there, and inline reads cleanly. Changing the default would restyle
 * the results panel on the strength of a guess.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FuelVintageNotice } from '../FuelVintageNotice';
import type { ResolvedFuelDataset } from '../../utils/fuelVintage';

const resolved: ResolvedFuelDataset = {
  requestedYear: 2023,
  datasetYear: 2023,
  fuelVintage: 2022,
  matchedRequestedYear: true,
  usedFallback: false,
  dataset: { datasetYear: 2023, producer: 'Jordan Evens' },
};

/** The row wrapping a value, i.e. what the panel sees as one line. */
function rowFor(rowTestId: string): HTMLElement {
  return screen.getByTestId(rowTestId);
}

describe('FuelVintageNotice row layout (#431)', () => {
  it('spreads label and value apart when the panel does', () => {
    render(<FuelVintageNotice resolved={resolved} layout="spread" />);

    for (const id of ['model-year-row', 'fuel-vintage-row']) {
      const row = rowFor(id);
      expect(row.style.display).toBe('flex');
      expect(row.style.justifyContent).toBe('space-between');
    }
  });

  it('stays inline by default, so the results panel is unchanged', () => {
    render(<FuelVintageNotice resolved={resolved} />);

    expect(rowFor('model-year-row').style.justifyContent).toBe('');
  });

  it('keeps both years and the producer in the spread layout', () => {
    // A layout change must not quietly drop content.
    render(<FuelVintageNotice resolved={resolved} layout="spread" />);

    expect(screen.getByTestId('model-year-value')).toHaveTextContent('2023');
    expect(screen.getByTestId('fuel-vintage-value')).toHaveTextContent('2022');
    expect(document.body.textContent).toContain('[Jordan Evens]');
    expect(document.body.textContent).toContain('(start-of-2023 fuel state)');
  });
});
