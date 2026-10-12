/**
 * A dead stream must not look like a running job.
 *
 * Franco: "we should probably address that."
 *
 * THE DEFECT. `useJobNotifications` already detects a dropped stream — it sets
 * `isConnected: false` in both `onerror` and the `error` listener — but
 * `JobStatusToastProps` carries only `status`. Neither `isConnected` nor
 * `error` reaches the toast. So when the stream dies mid-run the toast keeps
 * rendering its last known state, spinning, forever. The spinner is not
 * reporting progress at that point; it is reporting the absence of news, in the
 * same pixels it uses to report progress.
 *
 * This is a SECOND, INDEPENDENT route to the stuck spinner. The finalizer fix
 * closed the one where the engine stopped non-terminal and no branch resolved.
 * This one needs no engine fault at all — the run can be perfectly healthy and
 * still show a spinner that means nothing.
 *
 * WHY A GRACE PERIOD. SSE reconnects on its own, so a single `onerror` is
 * usually a blip of no interest to anyone. Surfacing every one of them would
 * train operators to ignore the indicator — which is how a warning becomes
 * noise, and noise is worse than silence because it is believed less.
 *
 * WHAT THE MESSAGE MUST NOT SAY. The run continues on the server whether or not
 * this browser is listening. Telling the operator the run failed would be a
 * confident wrong answer, which is worse than the spinner it replaces. The UI
 * lost contact; that is the fact, and it is the only fact available here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { JobStatusToast } from '../JobStatusToast';

const RUNNING = { id: 'j1', status: 'running', progress: 40 } as never;
const COMPLETED = { id: 'j1', status: 'completed', progress: 100 } as never;

/** Long enough that a blip is not reported, short enough to be useful. */
const STALE_AFTER_MS = 15_000;

describe('JobStatusToast — a dropped stream (#432 follow-up)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('the control: the toast still renders normally', () => {
    it('shows a connected running job with no connection notice', () => {
      render(<JobStatusToast status={RUNNING} isConnected />);
      // If this ever fails, every assertion below is about a component that
      // does not render rather than one that renders wrongly.
      expect(screen.queryByText(/reconnect|lost contact/i)).toBeNull();
    });
  });

  describe('a brief blip', () => {
    it('does not cry wolf before the grace period', () => {
      render(<JobStatusToast status={RUNNING} isConnected={false} />);

      act(() => {
        vi.advanceTimersByTime(STALE_AFTER_MS - 1_000);
      });

      expect(screen.queryByText(/lost contact/i)).toBeNull();
    });

    it('clears when the stream comes back, leaving nothing behind', () => {
      const { rerender } = render(<JobStatusToast status={RUNNING} isConnected={false} />);
      act(() => {
        vi.advanceTimersByTime(STALE_AFTER_MS + 1_000);
      });
      expect(screen.getByText(/lost contact/i)).toBeTruthy();

      rerender(<JobStatusToast status={RUNNING} isConnected />);
      expect(screen.queryByText(/lost contact/i)).toBeNull();
    });
  });

  describe('a stream that stays down', () => {
    it('says so once the grace period has passed', () => {
      render(<JobStatusToast status={RUNNING} isConnected={false} />);

      act(() => {
        vi.advanceTimersByTime(STALE_AFTER_MS + 1_000);
      });

      expect(screen.getByText(/lost contact/i)).toBeTruthy();
    });

    it('does NOT claim the run failed, because it has not', () => {
      // The run continues server-side whether or not this browser listens.
      // A confident wrong answer here is worse than the spinner it replaces.
      render(<JobStatusToast status={RUNNING} isConnected={false} />);
      act(() => {
        vi.advanceTimersByTime(STALE_AFTER_MS + 1_000);
      });

      const notice = screen.getByText(/lost contact/i).textContent ?? '';
      expect(notice).not.toMatch(/failed|cancelled|stopped|error/i);
      // And it says what IS true: the run may still be going.
      expect(notice).toMatch(/still/i);
    });
  });

  describe('a job that already finished', () => {
    it('says nothing about the connection — there is nothing left to stream', () => {
      // After a terminal status the stream closing is correct behaviour, and
      // reporting it would be reporting success as a problem.
      render(<JobStatusToast status={COMPLETED} isConnected={false} />);

      act(() => {
        vi.advanceTimersByTime(STALE_AFTER_MS + 1_000);
      });

      expect(screen.queryByText(/lost contact/i)).toBeNull();
    });
  });

  describe('backwards compatibility', () => {
    it('renders without the new props at all', () => {
      // Existing callers, and the two existing test files, pass only `status`.
      // An undefined isConnected must not be read as disconnected — that is
      // "not told" versus "told it is down", and they are different facts.
      render(<JobStatusToast status={RUNNING} />);

      act(() => {
        vi.advanceTimersByTime(STALE_AFTER_MS + 1_000);
      });

      expect(screen.queryByText(/lost contact/i)).toBeNull();
    });
  });
});
