import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreflightErrorModal } from '../PreflightErrorModal.js';

describe('PreflightErrorModal', () => {
  it("shows the parser's own reason rather than a generic apology", () => {
    render(<PreflightErrorModal message='Required column "date" not found in CSV' onDismiss={vi.fn()} />);
    expect(screen.getByText(/Required column "date" not found/)).toBeTruthy();
  });

  it('says plainly that nothing was created', () => {
    render(<PreflightErrorModal message="boom" onDismiss={vi.fn()} />);
    expect(document.body.textContent).toMatch(/not started|nothing was created/i);
  });

  it('dismisses without submitting anything', async () => {
    const onDismiss = vi.fn();
    render(<PreflightErrorModal message="boom" onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
