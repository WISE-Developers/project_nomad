/**
 * Prefilling the wizard from an imported .fgmj scenario (refs #294).
 *
 * Franco's steer: an Import Model button that prepopulates the wizard, rather
 * than an import-and-run endpoint. That matters beyond UX — the import plan
 * carries blockers only an operator can settle and divergences the operator
 * must SEE, and none of that has any channel to a human today. Running
 * straight from an import would discard all of it silently.
 *
 * Asserted against a fixture generated from the REAL wise_job_LWF-184-2021
 * plan (fixtures/lwf184-plan.json), not a hand-written object, so the mapping
 * is checked against what the backend actually produces.
 */

import { describe, it, expect } from 'vitest';
import { prefillFromImportPlan } from '../fromImportPlan';
import lwf184 from './fixtures/lwf184-plan.json';
import type { ImportedScenarioPlan } from '../fromImportPlan';

const plan = lwf184 as unknown as ImportedScenarioPlan;

describe('prefillFromImportPlan — temporal', () => {
  it('takes the local wall-clock date and time from the file’s own offset', () => {
    // The file says 2021-09-02T13:00:00-06:00. Parsing that through Date and
    // reading it back in the browser's zone is the #402 class of bug — an
    // evening start west of UTC rolls to the next day. The offset is already
    // in the string, so the wall clock is read from the string.
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.temporal?.startDate).toBe('2021-09-02');
    expect(initialData.temporal?.startTime).toBe('13:00');
  });

  it('carries the file’s offset as the timezone, not the browser’s', () => {
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.temporal?.timezone).toBe('-06:00');
    // 'imported', not 'inferred': the file recorded it. 'inferred' made the
    // wizard tell the operator it "was detected from this device" — false —
    // and made them confirm recorded data. See importedTimezone.test.ts.
    expect(initialData.temporal?.timezoneSource).toBe('imported');
  });

  it('carries the scenario duration and marks it as not a forecast', () => {
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.temporal?.durationHours).toBe(72);
    expect(initialData.temporal?.isForecast).toBe(false);
  });
});

describe('prefillFromImportPlan — geometry', () => {
  it('prefills the ignition as an uploaded feature', () => {
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.geometry?.inputMethod).toBe('upload');
    expect(initialData.geometry?.type).toBe('point');
    expect(initialData.geometry?.features).toHaveLength(1);
    const [feature] = initialData.geometry!.features;
    expect(feature.geometry.type).toBe('Point');
    expect(feature.geometry.coordinates).toEqual([-112.2258, 55.678433]);
  });

  it('names the ignition on the feature so the operator can see which it is', () => {
    const { initialData } = prefillFromImportPlan(plan);
    const [feature] = initialData.geometry!.features;
    expect(feature.properties?.name).toBe('ign5');
  });
});

describe('prefillFromImportPlan — weather', () => {
  it('selects raw_weather so the backend runs CFFDRS itself', () => {
    // A zero in a CFFDRS column tells FireSTARR not to burn that hour, so the
    // import never supplies index columns — it supplies observations plus
    // starting codes and lets WeatherService step them forward.
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.weather?.source).toBe('raw_weather');
  });

  it('carries the file’s starting codes', () => {
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.weather?.startingCodes).toEqual({ ffmc: 37, dmc: 2, dc: 297 });
  });

  it('presents the observations as a named file the weather step can read', () => {
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.weather?.rawWeatherFileName).toMatch(/\.csv$/);
    expect(initialData.weather?.rawWeatherFile).toBeInstanceOf(File);
  });

  it('does not set a firestarr_csv file, which would carry index columns', () => {
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.weather?.firestarrCsvFile).toBeUndefined();
  });
});

describe('prefillFromImportPlan — the model step', () => {
  /**
   * The prefill deliberately says NOTHING about the model step. ModelData
   * requires engine, runType, outputMode and modelMode together, and a .fgmj
   * does not tell us the last three — its scenario options are not Nomad's
   * run modes. Setting the field would mean inventing two or three values to
   * carry the one we know.
   *
   * The wizard default is already engine 'firestarr', which is the only
   * engine, so leaving it unset is both correct and honest.
   */
  it('leaves the model step to the wizard default rather than inventing run modes', () => {
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.model).toBeUndefined();
  });
});

describe('prefillFromImportPlan — what the operator must be told', () => {
  it('reports nothing unsupported for a single-ignition scenario', () => {
    const { unsupported } = prefillFromImportPlan(plan);
    expect(unsupported).toEqual([]);
  });

  it('passes the plan’s divergences and warnings through for display', () => {
    const withNotices: ImportedScenarioPlan = {
      ...plan,
      divergences: ['Fuel patch "x" was NOT applied'],
      warnings: ['humidity was clamped'],
    };
    const { notices } = prefillFromImportPlan(withNotices);
    expect(notices).toContain('Fuel patch "x" was NOT applied');
    expect(notices).toContain('humidity was clamped');
  });

  it('refuses to prefill a scenario that is not runnable', () => {
    const blocked: ImportedScenarioPlan = {
      ...plan,
      runnable: false,
      blockers: ['crs'],
      blockerDetail: ['the coordinates are projected and the CRS is not in the file'],
    };
    const { unsupported } = prefillFromImportPlan(blocked);
    expect(unsupported.join(' ')).toMatch(/crs|projected/i);
  });
});

describe('prefillFromImportPlan — multiple ignitions', () => {
  /**
   * The wizard cannot represent these yet. SpatialData.features is an array,
   * but the submit path reads features[0] only (App.tsx:167) and
   * RunModelRequest.ignition takes ONE geometry whose type cannot be
   * MultiPolygon. Prefilling two features would silently drop one — the
   * failure this whole issue has been guarding against.
   *
   * So it is reported as unsupported rather than quietly losing an ignition.
   */
  it('refuses rather than dropping the second ignition', () => {
    const two: ImportedScenarioPlan = {
      ...plan,
      ignitions: [
        plan.ignitions[0],
        { name: 'second', geometry: { type: 'Point', coordinates: [-112.0, 55.5] } },
      ],
    };
    const { unsupported } = prefillFromImportPlan(two);
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]).toMatch(/2 ignitions/);
    expect(unsupported[0]).toMatch(/drop/i);
  });
});
