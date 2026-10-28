import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode, useEffect, useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { OpenNomadProvider } from '../context/OpenNomadContext.js';
import { DashboardContainer } from '../../features/Dashboard/index.js';

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
    render(
      <StrictMode>
        <OpenNomadProvider adapter={adapter()}>
          <DashboardContainer mode="embedded" />
        </OpenNomadProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(document.body.textContent).toBeTruthy());
    const reactErrors = errors.filter(e =>
      /Warning:|Invalid hook call|Cannot update a component|not wrapped in act|Maximum update depth/.test(e),
    );
    expect(reactErrors, `React errors under StrictMode:\n${reactErrors.join('\n')}`).toEqual([]);
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
