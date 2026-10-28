import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode, useEffect, useState, type ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { OpenNomadProvider } from '../context/OpenNomadProvider.js';
import { DashboardContainer } from '../../features/Dashboard/components/DashboardContainer.js';

/**
 * EM3 renders every Nomad component it shows inside <StrictMode> — confirmed by
 * Meridian 2026-10-27: `src/main.tsx:137` wraps the app, and the Fire Modeling
 * Dashboard renders from `ToolHost.tsx:586` inside it. EM3 already carries THREE
 * workarounds for StrictMode double-invocation, all in map code
 * (LayerRegistry.ts:104, LayerDrawerProvider.tsx:204,
 * firePerimeterOverlay.ts:158). Nomad is a map component, and React 19 is
 * stricter here.
 *
 * Nothing in this repo's 775 tests rendered under StrictMode before this file.
 *
 * The CONTROL below is the point: it proves this harness actually detects a
 * non-idempotent effect. A StrictMode test that only renders the real component
 * passes whether or not the harness works, which is a check that cannot fail.
 */

let consoleError: ReturnType<typeof vi.spyOn>;
let errors: string[];

beforeEach(() => {
  errors = [];
  consoleError = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args.map(String).join(' '));
  });
});
afterEach(() => consoleError.mockRestore());


/**
 * Flatten a thrown value for the failure message. Under StrictMode a
 * commit-phase failure double-fires and React aggregates the pair, so the
 * thrown object's String() is the bare word "AggregateError" and every useful
 * message sits in `.errors`. Printing String(err) there tells the reader
 * nothing, which is how a real failure can look like noise.
 */
function describeThrown(e: unknown): string {
  const parts: string[] = [];
  const walk = (x: unknown, depth = 0): void => {
    if (x == null || depth > 4) return;
    const err = x as { message?: string; errors?: unknown[]; cause?: unknown };
    const name = (x as object)?.constructor?.name ?? typeof x;
    parts.push(`${name}: ${err.message ?? String(x)}`);
    if (Array.isArray(err.errors)) err.errors.forEach(inner => walk(inner, depth + 1));
    if (err.cause != null) walk(err.cause, depth + 1);
  };
  walk(e);
  return parts.join(' | ');
}

/** Render and capture a throw, so the assertion can print a readable cause. */
function renderCapturing(ui: ReactElement): unknown {
  try {
    render(ui);
    return null;
  } catch (e) {
    return e;
  }
}


/**
 * Owner for the key-warning control. It has its OWN component type on purpose:
 * React remembers which owner types it has already warned about, so a control
 * that emitted its warning from anonymous inline JSX silently suppressed the
 * same warning in a later test in this file. The control was contaminating the
 * subject — caught by mutation-testing, which is the only reason I know.
 */
function KeylessListForControl() {
  return <ul>{[1, 2, 3].map(n => <li>{n}</li>)}</ul>;
}

/** An effect that registers once and never cleans up — the real-world shape. */
function NonIdempotent({ registry }: { registry: string[] }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    registry.push('registered');
    if (registry.length > 1) {
      // What a duplicate registration does in a map: throws, or silently
      // double-draws. Made loud here so the harness has something to catch.
      console.error('duplicate registration: effect ran twice without cleanup');
    }
    setReady(true);
  }, [registry]);
  return <div>{ready ? 'ready' : 'pending'}</div>;
}

function Idempotent({ registry }: { registry: string[] }) {
  useEffect(() => {
    registry.push('registered');
    return () => {
      registry.pop();
    };
  }, [registry]);
  return <div>idempotent</div>;
}

describe('StrictMode harness (control)', () => {
  it("CATCHES a REAL warning from React itself, on the React actually installed", () => {
    // THE CONTROL THAT WAS MISSING, and whose absence let the old filtered
    // assertion look proven while being blind.
    //
    // The two controls below prove the spy captures console.error calls made by
    // OUR OWN code. That is the plumbing, not the channel: it says nothing about
    // whether the installed React reports anything through console.error. On
    // React 19 a render failure does not, and the prefix on those that do has
    // changed. So this asserts that React's own warning channel reaches the
    // harness on whatever version is resolved — if React ever stops using
    // console.error, this fails and tells us the instrument is deaf, rather than
    // the suite going quietly green.
    render(
      <StrictMode>
        <KeylessListForControl />
      </StrictMode>,
    );

    expect(
      errors.length,
      'React logged nothing for a missing key: this harness is not reading the ' +
        'channel React reports on, so every absence assertion in this file is vacuous',
    ).toBeGreaterThan(0);
    expect(errors.join(' ')).toMatch(/key/i);
  });

  it('describeThrown flattens an AggregateError, which is the StrictMode failure shape', () => {
    // Under StrictMode a commit-phase failure double-fires and React aggregates
    // the pair. Measured by Meridian on react 19.3.1: an invalid hook call in an
    // effect yields an AggregateError with errors=2 whose String() carries none
    // of the real messages. This helper runs only in the failure path, so if it
    // were wrong nobody would find out until they were already debugging.
    const agg = new AggregateError([new Error('first inner failure'), new Error('second inner failure')], '');

    // The hazard, stated as an assertion: the naive message loses everything.
    expect(String(agg)).not.toContain('first inner failure');
    expect(String(agg)).not.toContain('second inner failure');

    const described = describeThrown(agg);
    expect(described).toContain('first inner failure');
    expect(described).toContain('second inner failure');
  });

  it('describeThrown follows a cause chain', () => {
    const wrapped = new Error('outer wrapper', { cause: new Error('the root cause') });
    expect(String(wrapped)).not.toContain('the root cause');
    expect(describeThrown(wrapped)).toContain('the root cause');
  });

  it('CATCHES an effect that registers twice without cleanup', async () => {
    const registry: string[] = [];
    render(
      <StrictMode>
        <NonIdempotent registry={registry} />
      </StrictMode>,
    );
    await screen.findByText('ready');
    // This is the failure EM3 keeps working around. If this assertion ever stops
    // holding, StrictMode double-invocation is no longer being exercised and
    // every other test in this file has quietly stopped meaning anything.
    expect(registry.length).toBeGreaterThan(1);
    expect(errors.join('\n')).toMatch(/duplicate registration/);
  });

  it('PASSES an effect that cleans up after itself', async () => {
    const registry: string[] = [];
    render(
      <StrictMode>
        <Idempotent registry={registry} />
      </StrictMode>,
    );
    await screen.findByText('idempotent');
    expect(registry).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});

describe('DashboardContainer under StrictMode', () => {
  function adapter() {
    return {
      fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [], total: 0 }) }),
      models: {
        list: vi.fn().mockResolvedValue({ models: [], total: 0 }),
      },
    } as never;
  }

  it('renders without a React error when double-invoked', async () => {
    const thrownBy = renderCapturing(
      <StrictMode>
        <OpenNomadProvider adapter={adapter()}>
          <DashboardContainer mode="embedded" />
        </OpenNomadProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(document.body.textContent).toBeTruthy());

    // THE TWO CHANNELS ARE DISJOINT, and conflating them is what made the old
    // version of this test blind. Measured on react 19.3.1 / RTL 16.3.3 /
    // vitest 4 / jsdom, 2026-10-28, by me and independently by Meridian:
    //
    //   signal                                        throws      console.error
    //   throw in render (with or without StrictMode)   plain Error      0
    //   invalid hook call in an effect, no StrictMode  plain Error      0
    //   invalid hook call in an effect, StrictMode     AggregateError   0
    //   missing-key warning                            no               1
    //
    // So: FAILURES arrive ONLY as a throw, and WARNINGS arrive ONLY on
    // console.error. Two consequences, both learned the hard way:
    //
    // 1. The old assertion filtered console.error for
    //    /Warning:|Invalid hook call|Cannot update a component|not wrapped in act|Maximum update depth/
    //    which matched nothing React 19 emits — React 19 dropped the "Warning:"
    //    prefix — so it passed by reading a channel that had gone quiet.
    // 2. Asserting ZERO console.error lines does NOT fix that for failures,
    //    because zero is also what every failure looks like. That would fail
    //    SILENT, not closed. It is a valid WARNING detector and nothing more,
    //    which is all it is used for below.
    //
    // The throw is caught explicitly rather than left to bubble so the failure
    // message is readable: under StrictMode a commit-phase failure double-fires
    // and React aggregates the pair into an AggregateError whose String() is the
    // bare word "AggregateError", with the real messages in `.errors`.
    expect(thrownBy, thrownBy === null ? '' : `StrictMode render threw: ${describeThrown(thrownBy)}`).toBeNull();

    // Warning detector. Baseline is genuinely zero for this tree, measured on
    // React 18 and 19 — and it stays zero only because of `waitFor` above. An
    // earlier measurement of mine used setTimeout and produced six act(...)
    // warnings: my harness manufacturing the signal it was measuring.
    expect(errors, `console.error during a clean StrictMode render:\n${errors.join('\n')}`).toEqual([]);
  });

  it('survives mount, unmount and remount without throwing', async () => {
    const { unmount } = render(
      <StrictMode>
        <OpenNomadProvider adapter={adapter()}>
          <DashboardContainer mode="embedded" />
        </OpenNomadProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(document.body.textContent).toBeTruthy());
    expect(() => unmount()).not.toThrow();
    expect(() =>
      render(
        <StrictMode>
          <OpenNomadProvider adapter={adapter()}>
            <DashboardContainer mode="embedded" />
          </OpenNomadProvider>
        </StrictMode>,
      ),
    ).not.toThrow();
  });
});
