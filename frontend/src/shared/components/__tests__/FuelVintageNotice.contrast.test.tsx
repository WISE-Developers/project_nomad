/**
 * FuelVintageNotice — legibility (refs #319)
 *
 * The first cut styled this component with className hooks
 * (fuel-vintage-notice__warning) but never shipped any CSS for them, while
 * every neighbouring component in ModelSummary/ResultsSummary uses inline
 * styles. Result: it inherited whatever the parent had and rendered too light
 * to read on the results screen.
 *
 * A fuel-provenance warning nobody can read is worse than no warning, so this
 * asserts real WCAG contrast rather than pinning hex values — pinned hexes
 * would just encode the same guess that was wrong the first time.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FuelVintageNotice } from '../FuelVintageNotice';
import type { ResolvedFuelDataset } from '../../utils/fuelVintage';

const fellBack: ResolvedFuelDataset = {
  requestedYear: 2023,
  vintage: 2026,
  matchedRequestedYear: false,
  usedFallback: true,
  dataset: { vintage: 2026, producer: 'Jordan Evens' },
};

const exact: ResolvedFuelDataset = {
  requestedYear: 2026,
  vintage: 2026,
  matchedRequestedYear: true,
  usedFallback: false,
  dataset: { vintage: 2026, producer: 'Jordan Evens' },
};

/** Accepts "#rrggbb" or jsdom's "rgb(r, g, b)" -> [r,g,b] */
function parseColour(value: string): [number, number, number] {
  const raw = (value ?? '').trim();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (!hex) throw new Error(`not a usable colour: "${value}"`);
  const n = parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.1 relative luminance. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: string, bg: string): number {
  const [l1, l2] = [luminance(parseColour(fg)), luminance(parseColour(bg))].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

const AA_BODY = 4.5;

describe('FuelVintageNotice legibility', () => {
  it('sets an explicit colour on the warning rather than inheriting', () => {
    render(<FuelVintageNotice resolved={fellBack} />);

    const warning = screen.getByRole('status');
    expect(warning.style.color).not.toBe('');
    expect(warning.style.backgroundColor).not.toBe('');
  });

  it('meets WCAG AA contrast for the warning text', () => {
    render(<FuelVintageNotice resolved={fellBack} />);

    const warning = screen.getByRole('status');
    const ratio = contrastRatio(warning.style.color, warning.style.backgroundColor);
    expect(ratio).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('meets WCAG AA contrast for the vintage value against its own surface', () => {
    render(<FuelVintageNotice resolved={exact} />);

    const value = screen.getByTestId('fuel-vintage-value');
    const surface = screen.getByTestId('fuel-vintage-notice');
    const ratio = contrastRatio(value.style.color, surface.style.backgroundColor);
    expect(ratio).toBeGreaterThanOrEqual(AA_BODY);
  });

  it('does not rely on className hooks that have no stylesheet', () => {
    const { container } = render(<FuelVintageNotice resolved={fellBack} />);

    // Any class we emit must be backed by real CSS. We ship none, so emit none.
    const classed = container.querySelectorAll('[class]');
    expect(classed.length).toBe(0);
  });
});
