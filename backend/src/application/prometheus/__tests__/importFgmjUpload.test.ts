/**
 * Accepting an uploaded .fgmj job and returning its plan (refs #294).
 *
 * Parse only — nothing is persisted. The operator reviews the plan in the
 * wizard and a model is created when they submit, not when they upload. This
 * follows perimetersImport, not the ZIP model import, which writes records
 * immediately.
 *
 * A ZIP of the job FOLDER rather than a lone .fgmj, because the importer
 * resolves external weather as a sibling path — which is exactly why 6 corpus
 * files fail with "points at Inputs/spotwx_forecast.txt, which is not beside
 * the job". LWF-184 keeps its weather in Inputs/, and most real WISE jobs do.
 */

import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { importFgmjUpload, WIRE_FIELDS } from '../importFgmjUpload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');

/** A zip of the real WISE job, built from the real fixture directory. */
function lwf184Zip(): Buffer {
  const zip = new AdmZip();
  zip.addLocalFolder(path.join(TEST_DATA, 'wise_job_LWF-184-2021'));
  return zip.toBuffer();
}

describe('importFgmjUpload — a real WISE job as a zip', () => {
  it('plans the scenario the job describes', () => {
    const plans = importFgmjUpload(lwf184Zip(), 'wise_job_LWF-184-2021.zip');
    expect(plans).toHaveLength(1);
    const [plan] = plans;
    expect(plan.scenarioName).toContain('LWF-184-2021');
    expect(plan.runnable).toBe(true);
    expect(plan.blockers).toEqual([]);
  });

  it('finds the weather sibling inside the zip', () => {
    // The whole reason for taking a folder. A lone .fgmj cannot resolve this.
    const [plan] = importFgmjUpload(lwf184Zip(), 'job.zip');
    expect(plan.weatherRowCount).toBe(241);
    expect(plan.rawWeatherContent).toContain('Date,PREC,TEMP,RH,WS,WD');
  });

  it('carries the ignition geometry and the file’s own starting codes', () => {
    const [plan] = importFgmjUpload(lwf184Zip(), 'job.zip');
    expect(plan.ignitions).toHaveLength(1);
    expect(plan.ignitions[0].geometry.type).toBe('Point');
    expect(plan.startingCodes).toMatchObject({ ffmc: 37, dmc: 2, dc: 297 });
  });

  it('returns exactly the fields the wizard prefill expects, and no others', () => {
    // The frontend's ImportedScenarioPlan is the contract. A field renamed on
    // one side and not the other would fail silently as an undefined prefill.
    const [plan] = importFgmjUpload(lwf184Zip(), 'job.zip');
    expect(Object.keys(plan).sort()).toEqual([...WIRE_FIELDS].sort());
  });

  it('leaves nothing behind on disk', () => {
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('nomad-fgmj-'));
    importFgmjUpload(lwf184Zip(), 'job.zip');
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('nomad-fgmj-'));
    expect(after).toEqual(before);
  });
});

describe('importFgmjUpload — refusals', () => {
  it('refuses a zip with no .fgmj in it', () => {
    const zip = new AdmZip();
    zip.addFile('readme.txt', Buffer.from('nothing here'));
    expect(() => importFgmjUpload(zip.toBuffer(), 'empty.zip')).toThrow(/no \.fgmj/i);
  });

  it('refuses a zip holding more than one .fgmj rather than picking one', () => {
    const zip = new AdmZip();
    zip.addFile('a/job.fgmj', Buffer.from('x'));
    zip.addFile('b/job.fgmj', Buffer.from('y'));
    let message = '';
    try {
      importFgmjUpload(zip.toBuffer(), 'two.zip');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/more than one|2 \.fgmj/i);
    expect(message).toContain('a/job.fgmj');
    expect(message).toContain('b/job.fgmj');
  });

  it('refuses an entry whose path escapes the extraction directory', () => {
    // Zip slip, with a GENUINE traversal entry. AdmZip normalises "../" away
    // in addFile, so building one that way produces an archive with no
    // traversal in it at all — the first version of this test was vacuous, and
    // passed with the guard removed because the filename "escaped.fgmj"
    // happened to contain the substring the assertion matched. adm-zip does
    // NOT normalise on read, so setting entryName directly round-trips intact,
    // which is exactly what a malicious client would send.
    const zip = new AdmZip();
    zip.addFile('placeholder.fgmj', Buffer.from('x'));
    zip.getEntries()[0].entryName = '../../traversal.fgmj';
    const crafted = zip.toBuffer();
    expect(new AdmZip(crafted).getEntries()[0].entryName).toBe('../../traversal.fgmj');

    // Asserted on wording that is not a substring of the entry name.
    expect(() => importFgmjUpload(crafted, 'evil.zip')).toThrow(
      /resolves outside the extraction directory/i,
    );

    // And nothing was written where it pointed. os.tmpdir() is two levels up
    // from the extraction directory, which is what "../../" targets.
    expect(fs.existsSync(path.join(os.tmpdir(), '..', '..', 'traversal.fgmj'))).toBe(false);
  });

  it('refuses a file that is neither a zip nor a .fgmj', () => {
    expect(() => importFgmjUpload(Buffer.from('hello'), 'notes.txt')).toThrow(/\.zip|\.fgmj/i);
  });
});

describe('importFgmjUpload — the operator must still be told', () => {
  /**
   * The wire carried `divergences` with nothing asserting it: LWF-184 has
   * none, so a mutation emptying the field survived. sage1 declares a fuel
   * patch, and a blocked plan still reports its divergences — the operator
   * needs to know the import would differ even before the blockers clear.
   */
  it('carries divergences for a plan that has them, blocked or not', () => {
    const bare = fs.readFileSync(
      path.join(TEST_DATA, 'prometheus_job_sage1_patches_multiignition.fgmj'),
    );
    const plans = importFgmjUpload(bare, 'sage1.fgmj');
    const withFuelPatch = plans.find((p) => p.skippedFuelPatches.length > 0);
    expect(withFuelPatch).toBeDefined();
    expect(withFuelPatch!.divergences.join(' ')).toMatch(/fuel patch .* was NOT applied/i);
    expect(withFuelPatch!.skippedFuelPatches).toContain('all fuel to c2');
  });
});

describe('importFgmjUpload — a bare .fgmj', () => {
  it('accepts one whose weather is inline, and says so plainly when it is not', () => {
    // A lone .fgmj is allowed, but a job whose weather lives in Inputs/ will
    // refuse — correctly, and with the sibling path named.
    const bare = fs.readFileSync(path.join(TEST_DATA, 'wise_job_LWF-184-2021', 'job.fgmj'));
    let message = '';
    try {
      importFgmjUpload(bare, 'job.fgmj');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/not beside the job|spotwx_forecast/i);
  });
});
