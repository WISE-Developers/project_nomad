/**
 * The model execution panel must be resizable from its bottom-right corner
 * (#408).
 *
 * This panel is the only window onto what the engine is doing during a run.
 * Fixed-size, FireSTARR's own NOTE: output and long failure messages are cut
 * off — and the detail that matters is usually the part that does not fit. The
 * wizard has been resizable via react-rnd from the start; this panel was the
 * one that was not, with `enableResizing={false}` and a width pinned to whether
 * nerd mode is on.
 *
 * Franco asked specifically for a drag handle on the BOTTOM-RIGHT corner, so
 * that is asserted rather than "resizable in some direction": the panel sits
 * bottom-right against the viewport, and edges that grow it off-screen or drag
 * it under the map are not what was wanted.
 *
 * Rnd is mocked to capture its props. A real drag cannot be simulated
 * meaningfully in jsdom — react-rnd measures layout, and jsdom reports every
 * element as 0x0 — so asserting the CONTRACT handed to Rnd is the honest test.
 * Asserting a rendered pixel size here would pass whatever the config said.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

interface CapturedRndProps {
  enableResizing?: Record<string, boolean> | boolean;
  minWidth?: number;
  minHeight?: number;
  size?: { width: number | string; height: number | string };
  default?: { width: number | string; height: number | string; x: number; y: number };
  onResizeStop?: (
    e: unknown,
    dir: unknown,
    ref: { offsetWidth: number; offsetHeight: number },
    delta: unknown,
    pos: { x: number; y: number },
  ) => void;
}

let captured: CapturedRndProps = {};

vi.mock('react-rnd', () => ({
  Rnd: (props: CapturedRndProps & { children?: React.ReactNode }) => {
    captured = props;
    return <div data-testid="rnd">{props.children}</div>;
  },
}));

const { JobStatusToast } = await import('../JobStatusToast');

const RUNNING = {
  id: 'job-1',
  status: 'running' as const,
  progress: 0.5,
};

const STORAGE_KEY = 'nomad.jobStatusToast.size';

describe('JobStatusToast — resizable execution panel (#408)', () => {
  beforeEach(() => {
    captured = {};
    localStorage.clear();
  });

  it('enables resizing from the bottom-right corner', () => {
    render(<JobStatusToast status={RUNNING} />);

    expect(captured.enableResizing).toBeTruthy();
    expect(captured.enableResizing).not.toBe(false);
    const corners = captured.enableResizing as Record<string, boolean>;
    expect(corners.bottomRight).toBe(true);
  });

  it('does not offer the handles that would drag it off screen', () => {
    // The panel is anchored bottom-right. Growing from the top or left edge
    // moves the opposite edge off the viewport, which is not what was asked
    // for and is worse than not resizing at all.
    render(<JobStatusToast status={RUNNING} />);

    const corners = captured.enableResizing as Record<string, boolean>;
    expect(corners.top).toBe(false);
    expect(corners.left).toBe(false);
    expect(corners.topLeft).toBe(false);
  });

  it('keeps a minimum size so the panel cannot be collapsed to nothing', () => {
    render(<JobStatusToast status={RUNNING} />);

    expect(captured.minWidth).toBeGreaterThan(0);
    expect(captured.minHeight).toBeGreaterThan(0);
  });

  it('remembers the size the operator chose, across runs', () => {
    const { unmount } = render(<JobStatusToast status={RUNNING} />);

    captured.onResizeStop?.(
      null,
      'bottomRight',
      { offsetWidth: 700, offsetHeight: 420 },
      null,
      { x: 10, y: 20 },
    );
    unmount();

    captured = {};
    render(<JobStatusToast status={RUNNING} />);

    const size = captured.size ?? captured.default;
    expect(size?.width).toBe(700);
    expect(size?.height).toBe(420);
  });

  it('survives unreadable stored state rather than failing to render', () => {
    // localStorage is per-viewer and can hold anything. A panel that throws
    // here takes the only view of a running model with it.
    localStorage.setItem(STORAGE_KEY, 'not json');

    expect(() => render(<JobStatusToast status={RUNNING} />)).not.toThrow();
  });
});
