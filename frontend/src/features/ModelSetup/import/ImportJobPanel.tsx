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

/**
 * Styled to match SettingsModal — the app's existing modal language — rather
 * than a stylesheet, because this feature's siblings (App header, settings,
 * the status banner) all style inline and a new CSS file would be the odd one
 * out.
 *
 * It had classNames and NO stylesheet at all, so the panel rendered in document
 * flow underneath a fixed, full-viewport map: present in the DOM, reachable by
 * keyboard and screen reader, and invisible on screen. Found by looking at it.
 */
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 20000,
  padding: '16px',
  boxSizing: 'border-box',
};

const modalStyle: React.CSSProperties = {
  backgroundColor: '#1f2937',
  color: 'white',
  borderRadius: '8px',
  padding: '24px',
  width: 'calc(100% - 32px)',
  maxWidth: '680px',
  maxHeight: 'calc(100vh - 64px)',
  overflowY: 'auto',
  boxSizing: 'border-box',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
};

const titleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  margin: '0 0 8px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const introStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#9ca3af',
  lineHeight: 1.5,
  margin: '0 0 20px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: '#9ca3af',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const fileInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  backgroundColor: '#374151',
  border: '1px solid #4b5563',
  borderRadius: '6px',
  color: 'white',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#9ca3af',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  margin: '24px 0 10px',
};

const scenarioListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
};

const scenarioLabelStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: '4px 10px',
  alignItems: 'start',
  padding: '12px',
  backgroundColor: '#374151',
  border: '1px solid #4b5563',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
};

const scenarioMetaStyle: React.CSSProperties = {
  gridColumn: 2,
  fontSize: '12px',
  color: '#9ca3af',
};

const blockedStyle: React.CSSProperties = {
  gridColumn: 2,
  fontSize: '12px',
  color: '#fca5a5',
};

const noticeListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: '18px',
  fontSize: '13px',
  lineHeight: 1.5,
  color: '#fcd34d',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

const calmStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#9ca3af',
  margin: 0,
};

const unsupportedStyle: React.CSSProperties = {
  marginTop: '14px',
  padding: '12px',
  backgroundColor: '#7f1d1d',
  border: '1px solid #b91c1c',
  borderRadius: '6px',
  fontSize: '13px',
  lineHeight: 1.5,
};

const errorStyle: React.CSSProperties = {
  marginTop: '12px',
  padding: '12px',
  backgroundColor: '#7f1d1d',
  border: '1px solid #b91c1c',
  borderRadius: '6px',
  fontSize: '13px',
  lineHeight: 1.5,
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '8px',
  marginTop: '24px',
};

const buttonBaseStyle: React.CSSProperties = {
  padding: '9px 20px',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  border: 'none',
};

const cancelBtnStyle: React.CSSProperties = {
  ...buttonBaseStyle,
  backgroundColor: '#374151',
  color: 'white',
};

const setUpBtnStyle = (enabled: boolean): React.CSSProperties => ({
  ...buttonBaseStyle,
  backgroundColor: enabled ? '#2563eb' : '#374151',
  color: enabled ? 'white' : '#6b7280',
  cursor: enabled ? 'pointer' : 'not-allowed',
});

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
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Import a Prometheus or WISE job">
      <div style={modalStyle}>
        <h2 style={titleStyle}>
          <i className="fa-solid fa-file-import" />
          Import a Prometheus or WISE job
        </h2>

        <p style={introStyle}>
          Upload the job folder as a <strong>.zip</strong>, or the <strong>.fgmj</strong> on its
          own. A WISE job usually keeps its weather in a sibling <code>Inputs/</code> folder, so
          the zip is the safer choice.
        </p>

        <label htmlFor="fgmj-job-file" style={labelStyle}>Job file</label>
        <input
          id="fgmj-job-file"
          type="file"
          accept=".zip,.fgmj"
          onChange={handleFile}
          disabled={busy}
          style={fileInputStyle}
        />

        {busy && <p role="status" style={{ ...calmStyle, marginTop: '12px' }}>Reading the job…</p>}

        {error && (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        )}

        {scenarios && scenarios.length > 0 && (
          <>
            <h3 style={sectionHeadingStyle}>
              {scenarios.length === 1
                ? 'This job holds one scenario'
                : `This job holds ${scenarios.length} scenarios`}
            </h3>

            <ul style={scenarioListStyle}>
              {scenarios.map((scenario, index) => (
                <li key={`${scenario.scenarioName}-${index}`}>
                  <label style={scenarioLabelStyle}>
                    <input
                      type="radio"
                      name="fgmj-scenario"
                      checked={index === selected}
                      onChange={() => setSelected(index)}
                    />
                    <span style={{ fontWeight: 600 }}>{scenario.scenarioName}</span>
                    <span style={scenarioMetaStyle}>
                      {scenario.startTime.slice(0, 10)} · {scenario.durationHours} h ·{' '}
                      {scenario.ignitions.length || '—'} ignition
                      {scenario.ignitions.length === 1 ? '' : 's'}
                    </span>
                    {!scenario.runnable && (
                      <span style={blockedStyle}>
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
          <section>
            <h3 style={sectionHeadingStyle}>What will differ from the original run</h3>

            {prefill.notices.length === 0 ? (
              <p style={calmStyle}>
                No differences recorded — this scenario imports as the file describes it.
              </p>
            ) : (
              <ul style={noticeListStyle}>
                {prefill.notices.map((notice, i) => (
                  <li key={i}>{notice}</li>
                ))}
              </ul>
            )}

            {prefill.unsupported.length > 0 && (
              <div role="alert" style={unsupportedStyle}>
                <strong style={{ display: 'block', marginBottom: '6px' }}>
                  This scenario cannot be set up here
                </strong>
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  {prefill.unsupported.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {plan.blockerDetail.length > 0 && (
              <ul style={{ ...noticeListStyle, color: '#9ca3af', marginTop: '12px' }}>
                {plan.blockerDetail.map((detail, i) => (
                  <li key={i}>{detail}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div style={footerStyle}>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSetUp}
            style={setUpBtnStyle(canSetUp)}
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
    </div>
  );
}
