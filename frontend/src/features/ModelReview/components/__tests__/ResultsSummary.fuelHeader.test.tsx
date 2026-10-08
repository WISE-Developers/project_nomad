/**
 * The fuel vintage card needs a header like every other section (#431).
 *
 * On the results panel "Output Configuration", "Model Inputs" and "Model
 * Outputs" each render a titled header strip above their body. The fuel
 * vintage card was the only bordered section with no title at all, so the two
 * year rows floated in an unlabelled box — the reader has to infer what the
 * card is about from the rows themselves.
 *
 * Seen on screen 2026-10-08 against a real completed FireSTARR run. No
 * assertion could have caught it: the rows were present, correct, and
 * contrast-checked, and nothing was missing from the DOM except a label
 * nobody had asserted the need for.
 *
 * The title is asserted to live in the SAME card as the notice rather than
 * merely existing on the page, because "Fuel Data" appearing somewhere else
 * entirely would satisfy a looser check while leaving the card unlabelled.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultsSummary } from '../ResultsSummary.js';
import type { ExecutionSummary, ModelInputs } from '../../types/index.js';

const summary: ExecutionSummary = {
  startedAt: '2026-10-08T12:23:00.000Z',
  completedAt: '2026-10-08T12:51:52.000Z',
  durationSeconds: 1732,
  status: 'completed',
  progress: 100,
};

// The record the real 2026-10-08 run actually wrote.
const inputs = {
  modelStartDate: '2023-06-19T18:00:00.000Z',
  fuelVintage: {
    requestedYear: 2023, vintage: '2023', datasetYear: 2023, fuelVintage: 2022,
    matchedRequestedYear: true, usedFallback: false,
  },
} as ModelInputs;

function renderResults(withInputs: ModelInputs | undefined = inputs) {
  return render(
    <ResultsSummary
      modelId="071edf71"
      modelName="FireSTARR - 2023-06-19"
      engineType="firestarr"
      userId="tester"
      summary={summary}
      outputCount={3}
      inputs={withInputs}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ datasets: [], resolved: undefined }) }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('ResultsSummary fuel vintage card header (#431)', () => {
  it('titles the fuel vintage card, in the same card as the notice', () => {
    const { container } = renderResults();

    const notice = screen.getByTestId('fuel-vintage-notice');
    const title = screen.getByText('Fuel Data');

    expect(container.contains(title)).toBe(true);

    // The title must head the card the notice lives in, not sit elsewhere.
    const card = title.parentElement;
    expect(card).not.toBeNull();
    expect(card!.contains(notice)).toBe(true);
  });

  it('titles the card even when the run recorded no vintage', () => {
    // A run with nothing recorded still shows a row saying so; an unlabelled
    // box containing only that sentence is the least readable state of all.
    renderResults({ modelStartDate: '2023-06-19T18:00:00.000Z' } as ModelInputs);

    expect(screen.getByText('Fuel Data')).toBeInTheDocument();
  });
});
