/**
 * Adapting a recorded fuel vintage for display — issue #331.
 *
 * The run records the vintage DIRECTORY it used, which is either a year
 * ("2024") or "default". The display type expects a numeric vintage, so the
 * two have to be reconciled — without inventing a year for "default".
 */

import { describe, it, expect } from 'vitest';
import { recordedToResolved } from '../fuelVintage.js';

describe('recordedToResolved', () => {
  it('carries a year vintage through as a number', () => {
    const resolved = recordedToResolved({
      requestedYear: 2024,
      vintage: '2024',
      matchedRequestedYear: true,
      usedFallback: false,
    });

    expect(resolved.vintage).toBe(2024);
    expect(resolved.matchedRequestedYear).toBe(true);
    expect(resolved.usedFallback).toBe(false);
    expect(resolved.requestedYear).toBe(2024);
  });

  it('leaves the vintage undefined for a default dataset rather than inventing a year', () => {
    const resolved = recordedToResolved({
      requestedYear: 2024,
      vintage: 'default',
      matchedRequestedYear: false,
      usedFallback: true,
    });

    expect(resolved.vintage).toBeUndefined();
    expect(resolved.usedFallback).toBe(true);
  });

  it('preserves the mismatch when a different year stood in', () => {
    const resolved = recordedToResolved({
      requestedYear: 2024,
      vintage: '2023',
      matchedRequestedYear: false,
      usedFallback: true,
    });

    expect(resolved.vintage).toBe(2023);
    expect(resolved.matchedRequestedYear).toBe(false);
  });
});
