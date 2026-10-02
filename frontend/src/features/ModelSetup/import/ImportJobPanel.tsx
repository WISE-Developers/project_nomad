/**
 * Import a Prometheus/WISE job and choose a scenario to set up (refs #294).
 *
 * This panel exists instead of an import-and-run button. The importer produces
 * a plan carrying blockers only a person can settle and divergences the
 * operator must SEE — a fuel patch that could not be applied, a skipped
 * WindNinja field, a POLYGON_IN that grows inward, a point turned into a
 * circle. Running straight from a file would discard every one of them
 * silently.
 *
 * So: upload, pick a scenario, read what will differ, then set it up. The
 * wizard opens prefilled and the operator submits a run the same way as any
 * other model.
 */

import { useCallback, useState } from 'react';
import { prefillFromImportPlan, type ImportPrefill, type ImportedScenarioPlan } from './fromImportPlan';

export interface FgmjImportResponse {
  fileName: string;
  scenarios: ImportedScenarioPlan[];
  scenarioCount: number;
  runnableCount: number;
}

export interface ImportJobPanelProps {
  /** Called with the prefill once the operator chooses a scenario. */
  onSetUp: (prefill: ImportPrefill) => void;
  onCancel: () => void;
  /**
   * Injected so the panel can be tested without a server. Defaults to the
   * real endpoint.
   */
  upload?: (file: File) => Promise<FgmjImportResponse>;
}

/** POST the job to the parse-only import endpoint. */
async function postJob(file: File): Promise<FgmjImportResponse> {
  const body = new FormData();
  body.append('file', file);
  // No Content-Type: the browser sets the multipart boundary itself.
  const res = await fetch('/api/v1/import/fgmj', { method: 'POST', body });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.message ?? `Import failed: ${res.status}`);
  }
  return (await res.json()) as FgmjImportResponse;
}

export function ImportJobPanel({ onSetUp, onCancel, upload = postJob }: ImportJobPanelProps) {
  const [scenarios, setScenarios] = useState<ImportedScenarioPlan[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setBusy(true);
      setError(null);
      setScenarios(null);
      try {
        const result = await upload(file);
        setScenarios(result.scenarios);
        // Open on the first scenario that can actually be set up, since a job
        // often holds one runnable scenario among several.
        const firstRunnable = result.scenarios.findIndex((s) => s.runnable);
        setSelected(firstRunnable === -1 ? 0 : firstRunnable);
      } catch (e) {
        // Never silent: the refusals name the missing sibling, the ambiguous
        // archive, or the unreadable row, and that is what the operator needs.
        setError(e instanceof Error ? e.message : 'Import failed');
      } finally {
        setBusy(false);
      }
    },
    [upload],
  );

  const plan = scenarios?.[selected];
  const prefill = plan ? prefillFromImportPlan(plan) : null;
  const canSetUp = Boolean(prefill && prefill.unsupported.length === 0);

  return (
    <div className="import-job-panel">
      <h2>Import a Prometheus or WISE job</h2>

      <p>
        Upload the job folder as a <strong>.zip</strong>, or the <strong>.fgmj</strong> on its own.
        A WISE job usually keeps its weather in a sibling <code>Inputs/</code> folder, so the zip
        is the safer choice.
      </p>

      <label htmlFor="fgmj-job-file">Job file</label>
      <input
        id="fgmj-job-file"
        type="file"
        accept=".zip,.fgmj"
        onChange={handleFile}
        disabled={busy}
      />

      {busy && <p role="status">Reading the job…</p>}

      {error && (
        <div role="alert" className="import-job-panel__error">
          {error}
        </div>
      )}

      {scenarios && scenarios.length > 0 && (
        <>
          <h3>
            {scenarios.length === 1
              ? 'This job holds one scenario'
              : `This job holds ${scenarios.length} scenarios`}
          </h3>

          <ul className="import-job-panel__scenarios">
            {scenarios.map((scenario, index) => (
              <li key={`${scenario.scenarioName}-${index}`}>
                <label>
                  <input
                    type="radio"
                    name="fgmj-scenario"
                    checked={index === selected}
                    onChange={() => setSelected(index)}
                  />
                  <span>{scenario.scenarioName}</span>
                  <span>
                    {scenario.startTime.slice(0, 10)} · {scenario.durationHours} h ·{' '}
                    {scenario.ignitions.length || '—'} ignition
                    {scenario.ignitions.length === 1 ? '' : 's'}
                  </span>
                  {!scenario.runnable && (
                    <span className="import-job-panel__blocked">
                      Cannot be run as imported — {scenario.blockers.join(', ')}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      {plan && prefill && (
        <section className="import-job-panel__review">
          <h3>What will differ from the original run</h3>

          {prefill.notices.length === 0 ? (
            <p>
              No differences recorded — this scenario imports as the file describes it.
            </p>
          ) : (
            <ul className="import-job-panel__notices">
              {prefill.notices.map((notice, i) => (
                <li key={i}>{notice}</li>
              ))}
            </ul>
          )}

          {prefill.unsupported.length > 0 && (
            <div role="alert" className="import-job-panel__unsupported">
              <h4>This scenario cannot be set up here</h4>
              <ul>
                {prefill.unsupported.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </div>
          )}

          {!plan.blockerDetail.length ? null : (
            <ul className="import-job-panel__blockers">
              {plan.blockerDetail.map((detail, i) => (
                <li key={i}>{detail}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="import-job-panel__actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSetUp}
          onClick={() => {
            // Guarded as well as disabled, from the SAME value rather than a
            // second copy of the condition: a disabled button is a UI state,
            // not a guarantee, and setting up an unsupported scenario would
            // drop an ignition or run a plan with unresolved blockers. One
            // expression, so the two cannot drift apart.
            if (canSetUp && prefill) onSetUp(prefill);
          }}
        >
          Set up this scenario
        </button>
      </div>
    </div>
  );
}
