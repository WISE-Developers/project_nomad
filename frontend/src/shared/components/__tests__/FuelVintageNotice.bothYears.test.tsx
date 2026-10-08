/**
 * The notice must show BOTH the model year and the fuel vintage — issue #431.
 *
 * Showing one number and calling it the other is what produced the defect. An
 * analyst reading "Fuel vintage used: 2026" believes in fuels that cannot exist
 * yet, and nothing on screen reveals which convention is in play.
 *
 * Showing both makes the relationship visible, and makes any future drift
 * between them self-evident rather than silent.
 *
 * These tests do not touch the existing FuelVintageNotice tests; they pin the
 * new requirement alongside them.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FuelVintageNotice } from '../FuelVintageNotice';
import type { ResolvedFuelDataset } from '../../utils/fuelVintage';

function resolved(over: Partial<ResolvedFuelDataset> = {}): ResolvedFuelDataset {
  return {
    requestedYear: 2026,
    datasetYear: 2026,
    fuelVintage: 2025,
    matchedRequestedYear: true,
    usedFallback: false,
    ...over,
  };
}

describe('FuelVintageNotice shows model year and fuel vintage separately (#431)', () => {
  it('renders the model year under its own label', () => {
    render(<FuelVintageNotice resolved={resolved()} />);

    expect(screen.getByTestId('model-year-value')).toHaveTextContent('2026');
  });

  it('renders the fuel vintage as one year before the dataset used', () => {
    render(<FuelVintageNotice resolved={resolved()} />);

    expect(screen.getByTestId('fuel-vintage-value')).toHaveTextContent('2025');
  });

  it('never shows the same number for both', () => {
    render(<FuelVintageNotice resolved={resolved()} />);

    const modelYear = screen.getByTestId('model-year-value').textContent;
    const vintage = screen.getByTestId('fuel-vintage-value').textContent;

    expect(vintage).not.toBe(modelYear);
  });

  it('labels each value so neither can be mistaken for the other', () => {
    render(<FuelVintageNotice resolved={resolved()} />);

    // Both words must appear. "Fuel vintage: 2025" alone, with no model year
    // beside it, is how the original defect read as plausible.
    expect(screen.getByText(/model year/i)).toBeInTheDocument();
    expect(screen.getByText(/fuel vintage/i)).toBeInTheDocument();
  });

  it('shows the fuel of the dataset ACTUALLY used when lookup fell back', () => {
    // 2023 fire, fell back to the 2026 dataset: 2023 model year, 2025 fuel.
    render(
      <FuelVintageNotice
        resolved={resolved({
          requestedYear: 2023,
          datasetYear: 2026,
          fuelVintage: 2025,
          matchedRequestedYear: false,
          usedFallback: true,
        })}
      />
    );

    expect(screen.getByTestId('model-year-value')).toHaveTextContent('2023');
    expect(screen.getByTestId('fuel-vintage-value')).toHaveTextContent('2025');
  });

  it('says the vintage is not recorded rather than inferring one', () => {
    render(
      <FuelVintageNotice
        resolved={resolved({ datasetYear: undefined, fuelVintage: undefined, matchedRequestedYear: false, usedFallback: true })}
      />
    );

    expect(screen.getByTestId('model-year-value')).toHaveTextContent('2026');
    expect(screen.getByTestId('fuel-vintage-value')).toHaveTextContent(/not recorded/i);
  });
});
