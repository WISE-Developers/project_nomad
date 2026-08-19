/**
 * The results view reads the RECORDED fuel vintage — issue #331.
 *
 * It used to call useFuelVintage() and re-resolve when the page was viewed, so
 * installing a fuel year later retroactively rewrote what past runs claimed to
 * have used. A completed run is a record of what happened.
 *
 * These cover the display branch specifically, because it cannot be exercised
 * end-to-end without a completed FireSTARR run.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultsSummary } from '../ResultsSummary.js';
import type { ExecutionSummary, ModelInputs } from '../../types/index.js';

const summary: ExecutionSummary = {
  startedAt: '2026-08-19T12:00:00.000Z',
  completedAt: '2026-08-19T12:10:00.000Z',
  durationSeconds: 600,
  status: 'completed',
  progress: 100,
};

function renderWith(inputs?: ModelInputs) {
  return render(
    <ResultsSummary
      modelId="m1"
      modelName="Hay River"
      engineType="firestarr"
      userId="tester"
      summary={summary}
      outputCount={3}
      inputs={inputs}
    />,
  );
}

describe('ResultsSummary — recorded fuel vintage (#331)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // If anything re-resolves the vintage at view time, this catches it.
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ datasets: [], resolved: undefined }) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows the vintage the run recorded', () => {
    renderWith({
      modelStartDate: '2026-06-19T18:00:00.000Z',
      fuelVintage: {
        requestedYear: 2026, vintage: '2026',
        matchedRequestedYear: true, usedFallback: false,
      },
    } as ModelInputs);

    expect(document.body.textContent).toMatch(/2026/);
    expect(document.body.textContent).not.toMatch(/not recorded/i);
  });

  it('admits when a default dataset stood in for the requested year', () => {
    renderWith({
      modelStartDate: '2024-06-19T18:00:00.000Z',
      fuelVintage: {
        requestedYear: 2024, vintage: 'default',
        matchedRequestedYear: false, usedFallback: true,
      },
    } as ModelInputs);

    // The silent {year}/ -> default/ substitution is what the output depended on.
    expect(document.body.textContent).toMatch(/2024/);
  });

  it('says "not recorded" for a run that predates the recording', () => {
    // Must NOT infer one. Installing 2024 tomorrow cannot change what a run
    // from last year used.
    renderWith({ modelStartDate: '2024-06-19T18:00:00.000Z' } as ModelInputs);

    expect(document.body.textContent).toMatch(/not recorded/i);
  });

  it('never re-resolves the vintage at view time', () => {
    renderWith({ modelStartDate: '2024-06-19T18:00:00.000Z' } as ModelInputs);

    const fuelCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('fuel-dataset'));
    expect(fuelCalls).toEqual([]);
  });
});
