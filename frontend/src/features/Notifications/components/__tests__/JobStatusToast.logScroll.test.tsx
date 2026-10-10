/**
 * The execution log must stay scrollable once the panel has been resized.
 *
 * Regression from the resize work (#408). The log viewer is sized with
 * `{ flex: 1, minHeight: 0 }` the moment a size has been stored, but it sits
 * inside the nerd-mode wrapper, which was a plain `<div>` carrying only a
 * borderTop. `flex` and `min-height: 0` apply to FLEX ITEMS; the log's parent
 * was a block, so both were inert. The log grew to fit every line instead of
 * scrolling, the wrapper grew with it, and the outer flex column — which does
 * have `overflow: hidden` — silently clipped the remainder.
 *
 * Measured in the running app 2026-10-08 during a live FireSTARR run:
 *   log viewer   height 33238px, scrollHeight === clientHeight (never scrolled)
 *   wrapper      display: block, height 33260px
 *   flex column  height 683px, overflow: hidden  ->  ~32,500px unreachable
 *
 * The panel is the only window onto what the engine is doing, so the clipped
 * part is exactly the part an operator needs. It only reproduces once a size
 * is stored, which is why it survived: the unstored path uses a fixed
 * `height: 200px` and scrolls correctly.
 *
 * jsdom performs no layout — every element reports 0x0 — so asserting a
 * scrollHeight here would pass regardless of the CSS. The honest test is the
 * contract: if the log is sized as a flex item, its parent must be a flex
 * container, or the sizing does nothing. Same reasoning as
 * JobStatusToast.resize.test.tsx.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-rnd', () => ({
  Rnd: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

// jsdom ships no EventSource, and the component opens a log stream on mount.
// Without this the suite dies on a ReferenceError before reaching any
// assertion — a red that proves nothing about the layout under test.
class StubEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.stubGlobal('EventSource', StubEventSource);

import { JobStatusToast } from '../JobStatusToast';

const STORED_SIZE_KEY = 'nomad.jobStatusToast.size';

/** The log viewer is the only element carrying the monospace terminal stack. */
function findLogViewer(container: HTMLElement): HTMLElement {
  const el = Array.from(container.querySelectorAll('div')).find(d =>
    /Cascadia Code/.test(d.style.fontFamily),
  );
  if (!el) throw new Error('log viewer not found — is nerd mode on?');
  return el as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
  // A stored size is what puts the log on the flex branch. This is the state
  // any operator who has ever dragged the corner is permanently in.
  localStorage.setItem(STORED_SIZE_KEY, JSON.stringify({ width: 1096, height: 683 }));
});

describe('JobStatusToast log scrolling after resize (#408 regression)', () => {
  it('gives the log a flex parent, so its flex sizing is not inert', async () => {
    const { container } = render(
      <JobStatusToast status={{ id: 'j1', status: 'running', progress: 10 } as never} />,
    );

    // Nerd mode is off by default; the log only exists once it is on.
    fireEvent.click(screen.getByTitle('Show log'));

    const log = findLogViewer(container);
    const wrapper = log.parentElement!;

    // jsdom expands the `flex` shorthand, so assert the grow factor rather
    // than a serialised string that would break on a formatting change.
    expect(log.style.flexGrow).toBe('1');
    expect(wrapper.style.display).toBe('flex');
    expect(wrapper.style.flexDirection).toBe('column');
  });

  it('lets the wrapper shrink below its content height', async () => {
    const { container } = render(
      <JobStatusToast status={{ id: 'j1', status: 'running', progress: 10 } as never} />,
    );

    fireEvent.click(screen.getByTitle('Show log'));

    const wrapper = findLogViewer(container).parentElement!;

    // Without minHeight:0 a flex item refuses to shrink past its content, which
    // reproduces the same clipping one level up.
    expect(parseFloat(wrapper.style.minHeight)).toBe(0);
    expect(wrapper.style.flexGrow).toBe('1');
  });
});
