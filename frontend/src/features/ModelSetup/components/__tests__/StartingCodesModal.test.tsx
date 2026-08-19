/**
 * Starting-codes confirmation — issue #351.
 *
 * The user's file has the codes. This asks whether to use them, states plainly
 * what was found, and makes declining a real option that costs nothing.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StartingCodesModal } from '../StartingCodesModal.js';
import type { StartingCodeCandidate } from '../../utils/weatherPreflight.js';

const CANDIDATE: StartingCodeCandidate = {
  ffmc: 84.65,
  dmc: 20.72,
  dc: 424.9,
  observedAt: '2026-08-04T01:06:00.000Z',
  localLabel: '2026-08-03, 1900',
};

const MISMATCH = { dailyHour: 19, hoursFromNoon: 6, likelyZoneMismatch: true };
const ON_CONTRACT = { dailyHour: 13, hoursFromNoon: 0, likelyZoneMismatch: false };

describe('StartingCodesModal', () => {
  it('states the actual numbers found, not a vague reassurance', () => {
    render(<StartingCodesModal candidate={CANDIDATE} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/84\.65/)).toBeTruthy();
    expect(screen.getByText(/20\.72/)).toBeTruthy();
    expect(screen.getByText(/424\.9/)).toBeTruthy();
  });

  it('names when the reading was taken so the user can find it in their file', () => {
    render(<StartingCodesModal candidate={CANDIDATE} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/2026-08-03, 1900/)).toBeTruthy();
  });

  it('explains the two supported shapes rather than just refusing', () => {
    render(<StartingCodesModal candidate={CANDIDATE} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const text = document.body.textContent ?? '';
    expect(text).toMatch(/hourly/i);
    expect(text).toMatch(/starting codes/i);
  });

  it('uses the codes when the user accepts', async () => {
    const onConfirm = vi.fn();
    render(<StartingCodesModal candidate={CANDIDATE} onConfirm={onConfirm} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /use these/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('abandons the run when the user declines', async () => {
    const onCancel = vi.fn();
    render(<StartingCodesModal candidate={CANDIDATE} onConfirm={vi.fn()} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  describe('when the file has the shape but no usable reading', () => {
    it('offers no confirm button — there is nothing to accept', () => {
      render(<StartingCodesModal candidate={null} onConfirm={vi.fn()} onCancel={vi.fn()} />);

      expect(screen.queryByRole('button', { name: /use these/i })).toBeNull();
    });

    it('says why, rather than failing silently', () => {
      render(<StartingCodesModal candidate={null} onConfirm={vi.fn()} onCancel={vi.fn()} />);

      const text = document.body.textContent ?? '';
      expect(text).toMatch(/before/i);
      expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
    });
  });

  describe('timezone contract (#354)', () => {
    it('warns when the file sits away from local noon, naming the gap', () => {
      // Daily codes are recorded at noon local. Hers read 19:00 in Edmonton —
      // six hours ahead, which is exactly UTC.
      render(
        <StartingCodesModal
          candidate={CANDIDATE}
          rhythm={MISMATCH}
          timezone="America/Edmonton"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      const text = document.body.textContent ?? '';
      expect(text).toMatch(/6 hours ahead/i);
      expect(text).toMatch(/America\/Edmonton/);
    });

    it('names UTC as the likely cause when the gap matches the zone offset', () => {
      render(
        <StartingCodesModal
          candidate={CANDIDATE}
          rhythm={MISMATCH}
          timezone="America/Edmonton"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(document.body.textContent).toMatch(/UTC/);
    });

    it('says nothing about timezones when the file is on contract', () => {
      render(
        <StartingCodesModal
          candidate={CANDIDATE}
          rhythm={ON_CONTRACT}
          timezone="America/Edmonton"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(document.body.textContent).not.toMatch(/hours ahead|hours behind/i);
    });

    it('says nothing when there is no rhythm to report', () => {
      render(
        <StartingCodesModal
          candidate={CANDIDATE}
          rhythm={null}
          timezone="America/Edmonton"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      expect(document.body.textContent).not.toMatch(/hours ahead|hours behind/i);
    });
  });
});
