/**
 * #490 condition 1 — export must be initiable from the dashboard model list.
 *
 * The dashboard list holds model summaries, not loaded results. That is not an
 * obstacle: `ExportPanel` fetches its own manifest on mount from
 * `/api/v1/models/:id/export-manifest` and reads only `modelId`, `modelName` and
 * `onClose` — `outputs` and `preSelectedIds` are declared in its props and never
 * destructured. So the card only has to hand up a model.
 *
 * "Any model that has results" is `status === 'completed'`, which is the gate the
 * existing View Results / Add to Map / Re-run controls already sit behind. These
 * tests pin that the Export affordance sits behind the SAME gate, because the
 * failure condition 3 exists to remove is an export control that is present and
 * inert.
 *
 * @module features/Dashboard/components/__tests__
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelCard } from '../ModelCard.js';
import type { Model, ModelStatus } from '../../../../openNomad/api.js';

// The fixture is typed as `Model` with NO cast, so tsc is a live instrument here:
// if the interface gains a required field this file goes red rather than silently
// testing a shape that no longer exists.
function makeModel(status: ModelStatus, overrides: Partial<Model> = {}): Model {
  return {
    id: 'NOMAD-20261102-00001',
    name: 'Red Earth Creek',
    engine: 'firestarr',
    status,
    userId: 'tester',
    createdAt: '2026-11-02T09:00:00.000Z',
    updatedAt: '2026-11-02T09:30:00.000Z',
    ...overrides,
  };
}

const exportControl = () => screen.queryByRole('button', { name: /export/i });

describe('#490 C1 — Export from the dashboard model list', () => {
  it('offers Export on a completed model and hands the model up when clicked', async () => {
    const onExport = vi.fn();
    const model = makeModel('completed');

    render(<ModelCard model={model} onExport={onExport} />);

    const button = exportControl();
    expect(button).not.toBeNull();

    await userEvent.click(button!);

    expect(onExport).toHaveBeenCalledTimes(1);
    // The whole model, not just the id: ExportPanel needs modelName too, and the
    // list is the only place that already has it.
    expect(onExport).toHaveBeenCalledWith(model);
  });

  it.each<ModelStatus>(['running', 'failed', 'pending'])(
    'withholds Export on a %s model, because it has no results to export',
    (status) => {
      const onExport = vi.fn();

      render(<ModelCard model={makeModel(status)} onExport={onExport} />);

      expect(exportControl()).toBeNull();
    }
  );

  it('renders no Export control when no handler is wired, rather than an inert one', () => {
    render(<ModelCard model={makeModel('completed')} />);

    expect(exportControl()).toBeNull();
  });

  it('still offers the pre-existing completed-model controls alongside Export', async () => {
    // A control on the control: this asserts the instrument above can see buttons
    // at all. If the card stopped rendering its action row, every "withholds
    // Export" expectation above would pass for the wrong reason.
    const onViewResults = vi.fn();

    render(
      <ModelCard
        model={makeModel('completed')}
        onExport={vi.fn()}
        onViewResults={onViewResults}
      />
    );

    expect(screen.queryByRole('button', { name: /view results/i })).not.toBeNull();
    expect(exportControl()).not.toBeNull();
  });
});
