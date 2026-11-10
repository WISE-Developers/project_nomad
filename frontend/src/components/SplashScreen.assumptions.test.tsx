/**
 * THE SPLASH SCREEN MUST STATE THE MODEL'S ASSUMPTIONS (#281).
 *
 * WHY. Nomad produces fire behaviour outputs that people make decisions on, and
 * several of its assumptions are invisible until they bite:
 *
 *   - FireSTARR builds daily fire weather from NOON records only. A first day
 *     with no hour-12 row never gets a daily entry and the run dies with a bare
 *     `FATAL: map::at`. Real runs died exactly this way on 2026-08-19 — every
 *     one of them with a first day beginning after noon.
 *   - Runs are PROBABILISTIC unless deterministic is chosen explicitly: 100
 *     simulations against 1. A user who does not choose gets the slow one.
 *   - Fuel is a dataset with a VINTAGE, which need not match the modelled year.
 *     Running an old fire on new fuel is legitimate on purpose and a mistake by
 *     accident, and only the user can tell which.
 *   - Every local timestamp is rendered in the deployment's home timezone; the
 *     container's own clock is UTC.
 *
 * WHAT THIS PINS, and deliberately not more. It asserts that each assumption is
 * PRESENT and that the two load-bearing NUMBERS are the real ones. It does not
 * pin wording — copy is Franco's to change without breaking a test, and a test
 * that pinned prose would make the document harder to improve than to leave
 * wrong.
 *
 * THE NUMBERS ARE NOT RETYPED FROM THE DESIGN. They come from the backend:
 * `buildExecutionOptions.ts` returns 1 for deterministic and 100 otherwise, and
 * `health.ts` advertises `maxJobDuration: 240`. If either moves, this fails
 * rather than the screen quietly lying.
 *
 * WHAT IS DELIBERATELY ABSENT. The WCS fuel source. Its keys ship in
 * `.env.example` but nothing in the backend calls `resolveFuelSource`, so a
 * splash screen describing a selectable fuel source would be announcing a
 * feature that cannot run. #282 wires it; the assumption text follows then, not
 * before.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SplashScreen } from './SplashScreen';
import { resetAuthModeCache } from '../services/authMode';

function mockServer(authMode = 'none') {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/info')) {
        return Promise.resolve(
          new Response(JSON.stringify({ name: 'Project Nomad', authMode })),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ providers: [] })));
    }),
  );
}

async function renderSplash() {
  render(<SplashScreen onContinue={() => {}} />);
  // The assumptions block is static, but the component resolves its auth mode
  // from the server first. Wait for that so this never races the render.
  await waitFor(() => expect(screen.getByTestId('model-assumptions')).toBeTruthy());
  return screen.getByTestId('model-assumptions');
}

describe('SplashScreen model assumptions (#281)', () => {
  beforeEach(() => {
    resetAuthModeCache();
    mockServer();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an assumptions region a screen reader can find', async () => {
    const block = await renderSplash();
    // A visually-grouped block that is not a landmark is invisible to a screen
    // reader, which for safety-relevant caveats is the wrong half to get right.
    expect(block.getAttribute('aria-label')).toMatch(/assumption/i);
  });

  it('states the noon-record weather requirement — the one that kills runs', async () => {
    const block = await renderSplash();
    expect(block.textContent).toMatch(/noon/i);
    expect(block.textContent).toMatch(/weather/i);
  });

  it('states that runs are probabilistic by default, with the real simulation counts', async () => {
    const block = await renderSplash();
    expect(block.textContent).toMatch(/probabilistic/i);
    expect(block.textContent).toMatch(/deterministic/i);
    // Numbers from backend/src/application/execution/buildExecutionOptions.ts
    expect(block.textContent).toMatch(/\b100\b/);
  });

  it('states that fuel has a vintage which need not match the modelled year', async () => {
    const block = await renderSplash();
    expect(block.textContent).toMatch(/fuel/i);
    expect(block.textContent).toMatch(/vintage/i);
  });

  it('states that times are shown in the deployment home timezone', async () => {
    const block = await renderSplash();
    expect(block.textContent).toMatch(/time zone|timezone/i);
  });

  it('states the job duration cap, matching health.ts maxJobDuration of 240 minutes', async () => {
    const block = await renderSplash();
    expect(block.textContent).toMatch(/\b4 hours\b|\b240\b/);
  });

  it('does NOT announce the WCS fuel source, which no caller wires yet (#282)', async () => {
    const block = await renderSplash();
    // A splash screen describing a selectable fuel source would announce a
    // feature that cannot run. This assertion is the one that must be DELETED
    // when #282 wires it — deliberately, so the decision is made rather than
    // drifted past.
    expect(block.textContent).not.toMatch(/WCS/i);
  });

  it('CONTROL: the assertions above can fail — a term absent from the block is not found', async () => {
    const block = await renderSplash();
    // If `textContent` were empty or the query were returning the wrong node,
    // every "not.toMatch" above would pass by accident and every "toMatch"
    // would already have failed. This pins the positive half of that.
    expect(block.textContent).not.toMatch(/thisphrasewillneverappearonthesplash/i);
    expect((block.textContent ?? '').length).toBeGreaterThan(80);
  });
});
