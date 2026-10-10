/**
 * FuelVintageNotice must sit on the surface its container actually uses (#431).
 *
 * The component hard-coded SURFACE = '#ffffff'. That is right in ResultsSummary,
 * whose wrapper declares no background and sits on a white container, and wrong
 * in ModelSummary, whose card is '#f8f9fa' (ModelSummary.tsx:26) — the notice
 * rendered as a white rectangle inset 17px inside a grey card, reading as a
 * rendering seam rather than a deliberate highlight.
 *
 * Tests could not catch it: every assertion was about which numbers appear and
 * whether their contrast clears AA, and both remained true while the block
 * looked wrong. Verified on screen 2026-10-08 — notice rgb(255,255,255) inside
 * a parent of rgb(248,249,250).
 *
 * The component must therefore not assume a surface it does not own. It keeps
 * declaring one explicitly — the contrast tests depend on that, and inheriting
 * is what made the warning unreadable the first time (#319) — but the caller
 * decides which.
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
  dataset: { datasetYear: 2023, fuelVintage: 2022, producer: 'Jordan Evens' },
};

describe('FuelVintageNotice surface (#431)', () => {
  it('renders on the surface the caller declares', () => {
    render(<FuelVintageNotice resolved={resolved} surface="#f8f9fa" />);

    const notice = screen.getByTestId('fuel-vintage-notice');
    expect(notice.style.backgroundColor).toBe('rgb(248, 249, 250)');
  });

  it('still declares an explicit surface when the caller gives none', () => {
    // ResultsSummary relies on this default, and the contrast tests read it.
    // Inheriting silently is the #319 defect; absence is not an acceptable value.
    render(<FuelVintageNotice resolved={resolved} />);

    const notice = screen.getByTestId('fuel-vintage-notice');
    expect(notice.style.backgroundColor).toBe('rgb(255, 255, 255)');
  });
});

describe('FuelVintageNotice producer formatting (#431)', () => {
  it('renders the producer in square brackets, not a second parenthesis', () => {
    // "2022 (start-of-2023 fuel state) (Jordan Evens)" stacked two parenthetical
    // groups back to back. Papa's call 2026-10-08: keep the producer, bracket it.
    render(<FuelVintageNotice resolved={resolved} />);

    const row = screen.getByTestId('fuel-vintage-value').parentElement;
    expect(row).toHaveTextContent('(start-of-2023 fuel state)');
    expect(row).toHaveTextContent('[Jordan Evens]');
    expect(row).not.toHaveTextContent('(Jordan Evens)');
  });
});
