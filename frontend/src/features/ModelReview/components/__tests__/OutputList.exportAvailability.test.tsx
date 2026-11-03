/**
 * Characterization: export is never silently absent (#490, condition 3).
 *
 * THIS TEST EXISTS BECAUSE CONDITION 3 NEEDED NO CODE, and that was only
 * established by reading the component rather than the issue.
 *
 * #490's condition 3 says a model with no results "does not silently do
 * nothing", and names `showExportPanel && results` in ModelReviewPanel as the
 * fail-closed gate. Two things are wrong with that premise:
 *
 *  1. That gate cannot be reached with a null. The Export control lives in
 *     OutputList, which only renders in the branch where `results` already
 *     exists, and useModelResults' catch block spreads `...prev` and never
 *     clears `results` — so once loaded, they stay loaded.
 *
 *  2. The zero-outputs case, which IS reachable (ModelResultsService returns
 *     `outputs: []` with `error: 'Model has not been executed'` for a model
 *     that was never run), is already handled: OutputList returns early with
 *     an empty state that SAYS WHY. "Does not offer export" plus an
 *     explanation is the first of the two outcomes condition 3 permits.
 *
 * So the condition is satisfied by existing behaviour. What was missing was not
 * the behaviour but a guard on it: nothing stopped someone deleting the
 * explanation and leaving a blank card, which is the defect condition 3
 * describes. This pins it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutputList } from '../OutputList';

const anOutput = {
  id: 'r1',
  type: 'perimeter',
  filename: 'perimeter.geojson',
} as never;

describe('OutputList export availability (#490 condition 3)', () => {
  it('offers export when there are outputs', () => {
    render(
      <OutputList
        outputs={[anOutput]}
        onDownload={() => {}}
        onAddToMap={() => {}}
        onExport={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /export/i })).toBeEnabled();
  });

  it('withholds export for a model with no outputs, AND SAYS WHY', () => {
    render(
      <OutputList
        outputs={[]}
        onDownload={() => {}}
        onAddToMap={() => {}}
        onExport={vi.fn()}
      />,
    );
    // No export control — permitted by condition 3 ("does not offer export").
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
    // But the absence must be explained, which is the half that makes it
    // "not silently doing nothing".
    expect(screen.getByText(/no outputs available/i)).toBeInTheDocument();
    expect(
      screen.getByText(/outputs will appear here when the model completes/i),
    ).toBeInTheDocument();
  });

  it('shows no export control when the caller wires no handler', () => {
    // Opt-in: a surface that cannot export must not imply that it can.
    render(<OutputList outputs={[anOutput]} onDownload={() => {}} onAddToMap={() => {}} />);
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
  });
});
