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
  vintage: 2023,
  matchedRequestedYear: true,
  usedFallback: false,
  dataset: { vintage: 2023, producer: 'Jordan Evens', buildDate: '2022-11-01' },
};

const fellBack: ResolvedFuelDataset = {
  requestedYear: 2019,
  vintage: 2026,
  matchedRequestedYear: false,
  usedFallback: true,
  dataset: { vintage: 2026, producer: 'Jordan Evens' },
};

describe('FuelVintageNotice', () => {
  it('shows the vintage when it matches the modelled year', () => {
    render(<FuelVintageNotice resolved={exact} />);

    expect(screen.getByText(/2023/)).toBeInTheDocument();
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

    expect(screen.getByTestId('fuel-vintage-value')).toHaveTextContent('2026');
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
