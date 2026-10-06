/**
 * FuelVintageNotice — shows which fuel vintage a run uses (#319).
 *
 * Used in both model setup and results. The warning it can render is advisory:
 * it must never gate the run, and must never be the only thing shown (the
 * vintage itself is useful information even when nothing is wrong).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FuelVintageNotice } from '../FuelVintageNotice';
import type { ResolvedFuelDataset } from '../../utils/fuelVintage';

const exact: ResolvedFuelDataset = {
  requestedYear: 2023,
  datasetYear: 2023, fuelVintage: 2022,
  matchedRequestedYear: true,
  usedFallback: false,
  dataset: { datasetYear: 2023, fuelVintage: 2022, producer: 'Jordan Evens', buildDate: '2022-11-01' },
};

const fellBack: ResolvedFuelDataset = {
  requestedYear: 2019,
  datasetYear: 2026, fuelVintage: 2025,
  matchedRequestedYear: false,
  usedFallback: true,
  dataset: { datasetYear: 2026, fuelVintage: 2025, producer: 'Jordan Evens' },
};

describe('FuelVintageNotice', () => {
  it('shows the model year and the fuel vintage it implies (#431)', () => {
    render(<FuelVintageNotice resolved={exact} />);

    // The 2023 dataset is start-of-2023 fuel, i.e. the 2022 vintage. Asserting
    // the two values separately rather than matching /2023/ anywhere on screen,
    // which passed even when only one number was displayed.
    expect(screen.getByTestId('model-year-value')).toHaveTextContent('2023');
    expect(screen.getByTestId('fuel-vintage-value')).toHaveTextContent('2022');
  });

  it('shows no warning on an exact match', () => {
    render(<FuelVintageNotice resolved={exact} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows an advisory warning when the year fell back', () => {
    render(<FuelVintageNotice resolved={fellBack} />);

    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent(/2019/);
    expect(warning).toHaveTextContent(/2026/);
  });

  it('still shows the vintage alongside the warning', () => {
    render(<FuelVintageNotice resolved={fellBack} />);

    // Fell back to the 2026 dataset, which carries 2025-vintage fuel (#431).
    expect(screen.getByTestId('fuel-vintage-value')).toHaveTextContent('2025');
  });

  it('renders nothing rather than an error when resolution is unavailable', () => {
    const { container } = render(<FuelVintageNotice resolved={undefined} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('announces the warning politely, not assertively — it is not an alarm', () => {
    render(<FuelVintageNotice resolved={fellBack} />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
