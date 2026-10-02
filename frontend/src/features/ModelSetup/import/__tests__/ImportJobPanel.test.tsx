/**
 * Choosing a scenario from an imported job, and seeing what will differ
 * (refs #294) — pieces 3 and 4.
 *
 * One .fgmj commonly holds several scenarios: SS008-25 and FS001-23 each hold
 * three. So the operator picks one, and before they set it up they see what the
 * import could not carry faithfully.
 *
 * The whole reason this panel exists rather than an import-and-run button: the
 * plan's divergences and blockers had no channel to a human, and running
 * straight from a file would discard them silently.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportJobPanel } from '../ImportJobPanel';
import type { ImportedScenarioPlan } from '../fromImportPlan';
import lwf184 from './fixtures/lwf184-plan.json';

const runnable = lwf184 as unknown as ImportedScenarioPlan;

const blocked: ImportedScenarioPlan = {
  ...runnable,
  scenarioName: 'SS008-25 BEST Case Scenario',
  runnable: false,
  blockers: ['crs'],
  blockerDetail: ['the coordinates are projected and the file does not record the CRS'],
  divergences: ['Fuel patch "all fuel to c2" was NOT applied'],
};

const upload = (scenarios: ImportedScenarioPlan[]) =>
  vi.fn().mockResolvedValue({ fileName: 'job.zip', scenarios, scenarioCount: scenarios.length, runnableCount: scenarios.filter((s) => s.runnable).length });

async function pickFile(file: File) {
  const input = screen.getByLabelText(/job file/i);
  await userEvent.upload(input, file);
}

const zip = () => new File(['PK'], 'job.zip', { type: 'application/zip' });

describe('ImportJobPanel — choosing a scenario', () => {
  it('lists every scenario the job holds', async () => {
    render(<ImportJobPanel upload={upload([runnable, blocked])} onSetUp={vi.fn()} onCancel={vi.fn()} />);
    await pickFile(zip());
    await waitFor(() => expect(screen.getByText(runnable.scenarioName)).toBeInTheDocument());
    expect(screen.getByText(blocked.scenarioName)).toBeInTheDocument();
  });

  it('marks a scenario that cannot be run as imported, with the reason', async () => {
    render(<ImportJobPanel upload={upload([blocked])} onSetUp={vi.fn()} onCancel={vi.fn()} />);
    await pickFile(zip());
    await waitFor(() => expect(screen.getByText(blocked.scenarioName)).toBeInTheDocument());
    // The blocker is named in two places on purpose — once as a marker beside
    // the scenario, once in the review with the detail — so these assert the
    // specific wording of each rather than a substring that matches both.
    expect(screen.getByText(/Cannot be run as imported — crs/i)).toBeInTheDocument();
    const detail = screen.getAllByText(
      /the coordinates are projected and the file does not record the CRS/i,
    );
    expect(detail.length).toBeGreaterThan(0);
  });

  it('hands the prefill up when a runnable scenario is set up', async () => {
    const onSetUp = vi.fn();
    render(<ImportJobPanel upload={upload([runnable])} onSetUp={onSetUp} onCancel={vi.fn()} />);
    await pickFile(zip());
    await waitFor(() => expect(screen.getByText(runnable.scenarioName)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /set up/i }));

    expect(onSetUp).toHaveBeenCalledTimes(1);
    const prefill = onSetUp.mock.calls[0][0];
    expect(prefill.initialData.temporal.startDate).toBe('2021-09-02');
    expect(prefill.initialData.temporal.startTime).toBe('13:00');
    expect(prefill.initialData.weather.source).toBe('raw_weather');
  });

  it('will not set up a scenario the wizard cannot represent', async () => {
    const onSetUp = vi.fn();
    render(<ImportJobPanel upload={upload([blocked])} onSetUp={onSetUp} onCancel={vi.fn()} />);
    await pickFile(zip());
    await waitFor(() => expect(screen.getByText(blocked.scenarioName)).toBeInTheDocument());
    const button = screen.getByRole('button', { name: /set up/i });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onSetUp).not.toHaveBeenCalled();
  });
});

describe('ImportJobPanel — telling the operator what will differ', () => {
  it('shows the divergences before anything is set up', async () => {
    const withDivergence: ImportedScenarioPlan = {
      ...runnable,
      divergences: ['Fuel patch "all fuel to c2" was NOT applied — fuels come from Nomad'],
      warnings: ['relative humidity was clamped to 100'],
    };
    render(<ImportJobPanel upload={upload([withDivergence])} onSetUp={vi.fn()} onCancel={vi.fn()} />);
    await pickFile(zip());
    await waitFor(() => expect(screen.getByText(/all fuel to c2/)).toBeInTheDocument());
    expect(screen.getByText(/clamped to 100/)).toBeInTheDocument();
  });

  it('says plainly when the import carries no differences', async () => {
    render(<ImportJobPanel upload={upload([runnable])} onSetUp={vi.fn()} onCancel={vi.fn()} />);
    await pickFile(zip());
    await waitFor(() => expect(screen.getByText(runnable.scenarioName)).toBeInTheDocument());
    expect(screen.getByText(/no differences/i)).toBeInTheDocument();
  });

  it('reports an upload failure instead of failing silently', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('contains no .fgmj job file'));
    render(<ImportJobPanel upload={failing} onSetUp={vi.fn()} onCancel={vi.fn()} />);
    await pickFile(zip());
    await waitFor(() => expect(screen.getByText(/contains no \.fgmj job file/)).toBeInTheDocument());
  });
});
