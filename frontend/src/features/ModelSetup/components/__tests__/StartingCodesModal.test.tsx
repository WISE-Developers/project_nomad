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
});
