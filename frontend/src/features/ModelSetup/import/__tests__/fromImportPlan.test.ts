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

describe('prefillFromImportPlan — refuses a geometry the form cannot draw', () => {
  /**
   * Repurposed from the old "refuses rather than dropping the second ignition".
   *
   * That test guarded a real constraint — the submit path read features[0] and
   * the run request could not carry a MultiPolygon — and both were fixed in the
   * #294 merge, so refusing on COUNT is now wrong. What stays worth guarding is
   * refusing on TYPE: a geometry the setup form genuinely cannot draw must be
   * reported, never silently dropped. That was the real defect underneath.
   *
   * DRAWING_MODES covers Point, LineString and Polygon. Anything else — a
   * GeometryCollection, a MultiPolygon arriving unmerged — has no drawing mode,
   * and a feature that cannot be drawn cannot be edited, confirmed, or seen.
   *
   * The second case below is the hole that supporting multiple ignitions opens:
   * the check reads `const [first] = plan.ignitions` and inspects only that one.
   * While the importer refused every multi-ignition plan outright, looking at the
   * first was sufficient. It is not any more — an undrawable SECOND ignition now
   * reaches the map unexamined.
   */
  it('reports an undrawable geometry rather than dropping it', () => {
    const undrawable: ImportedScenarioPlan = {
      ...plan,
      ignitions: [
        {
          name: 'collection',
          geometry: { type: 'GeometryCollection', coordinates: [] },
        },
      ],
    } as unknown as ImportedScenarioPlan;
    const { unsupported } = prefillFromImportPlan(undrawable);
    expect(unsupported.some((u) => /cannot draw or carry/.test(u))).toBe(true);
    expect(unsupported.some((u) => /collection/.test(u))).toBe(true);
  });

  it('checks EVERY ignition, not just the first', () => {
    const secondUndrawable: ImportedScenarioPlan = {
      ...plan,
      ignitions: [
        plan.ignitions[0],
        {
          name: 'bad-second',
          geometry: { type: 'GeometryCollection', coordinates: [] },
        },
      ],
    } as unknown as ImportedScenarioPlan;
    const { unsupported } = prefillFromImportPlan(secondUndrawable);
    // Deliberately matched on ONE string carrying BOTH the name and the type
    // wording. A bare /bad-second/ passes vacuously today: the count refusal
    // interpolates every ignition name, so it matches that message instead of
    // the type check and stays green with the type guard deleted.
    expect(
      unsupported.some((u) => /bad-second/.test(u) && /cannot draw or carry/.test(u)),
    ).toBe(true);
  });
});

describe('prefillFromImportPlan — multiple ignitions reach the map (refs #294)', () => {
  /**
   * The refusal above was correct when it was written and is not any more.
   *
   * Its stated reasons were that the submit path read `features[0]` only and
   * that the run request could not carry a MultiPolygon. Both were fixed in
   * the #294 merge: App.tsx now sends EVERY drawn feature, GeometryType
   * .MultiPolygon goes through SpatialGeometry, WKT, the rasterizer type gates
   * and buildParams, and the backend merges N ignitions via mergeIgnitions and
   * returns ignitionNotices.
   *
   * The proof that the wizard can carry this is that HAND-DRAWN multi-ignition
   * already runs end to end and is validated. The wizard holds several features
   * perfectly well; only the import prefill truncates, at `.slice(0, 1)`.
   *
   * Note what is NOT being asserted: a single DrawnFeature holding a
   * MultiPolygon. DrawnFeature is a union of Feature<Point> | Feature<LineString>
   * | Feature<Polygon> — a feature of a union is not a union of features — so a
   * multi-part geometry still cannot be one drawn feature. It does not need to
   * be. N features go to the map and the existing merge makes them one ignition,
   * which is exactly what the hand-drawn path does.
   */
  const twoIgnitions: ImportedScenarioPlan = {
    ...plan,
    ignitions: [
      plan.ignitions[0],
      { name: 'second', geometry: { type: 'Point', coordinates: [-112.0, 55.5] } },
    ],
  } as ImportedScenarioPlan;

  it('prefills BOTH ignitions as drawn features rather than keeping only the first', () => {
    const { initialData } = prefillFromImportPlan(twoIgnitions);
    const features = initialData.geometry?.features ?? [];
    expect(features).toHaveLength(2);
  });

  it('does not report the ignition count as unsupported', () => {
    const { unsupported } = prefillFromImportPlan(twoIgnitions);
    expect(unsupported.filter((u) => /\d+ ignitions/.test(u))).toHaveLength(0);
  });

  it('keeps each ignition distinguishable by its own name', () => {
    // Merging happens in the backend, deliberately. If the prefill collapsed
    // them here the operator would lose the ability to see, on the map, what
    // the file actually declared before anything was merged.
    const { initialData } = prefillFromImportPlan(twoIgnitions);
    const names = (initialData.geometry?.features ?? []).map(
      (f) => (f.properties as { name?: string } | undefined)?.name,
    );
    expect(names).toContain('second');
    expect(new Set(names).size).toBe(2);
  });
});

describe('prefillFromImportPlan — the weather step must see the attached file', () => {
  /**
   * RawWeatherUpload decides whether a file is attached with
   * `const hasFile = !!fileName && !!parsed` — it needs BOTH. The prefill set
   * only the name, so step 2 showed an empty "Click or drag file to upload"
   * dropzone for weather that was already there, while Review listed the
   * filename and the validator was satisfied. Found by walking the wizard in a
   * browser.
   *
   * Parsed with the same shared parseCSV + buildParsedWeatherCSV the real
   * upload path uses, so an imported file is summarised identically to an
   * uploaded one rather than by a second implementation.
   */
  it('parses the observations so the dropzone shows them', () => {
    const { initialData } = prefillFromImportPlan(plan);
    const parsed = initialData.weather?.rawWeatherParsed;
    expect(parsed).toBeDefined();
    expect(parsed!.headers).toEqual(['Date', 'PREC', 'TEMP', 'RH', 'WS', 'WD']);
    // The fixture is trimmed to a header plus 3 rows.
    expect(parsed!.rowCount).toBe(3);
  });

  it('reports no FWI columns, which is the whole point of raw weather', () => {
    // If this ever said true, the operator would be told the file already
    // carries indices and CFFDRS would be skipped.
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.weather?.rawWeatherParsed?.hasFWIColumns).toBe(false);
  });

  it('sets both halves of what the uploader checks', () => {
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.weather?.rawWeatherFileName).toBeTruthy();
    expect(initialData.weather?.rawWeatherParsed).toBeTruthy();
  });

  it('attaches nothing when the plan carried no weather content', () => {
    const { initialData } = prefillFromImportPlan({ ...plan, rawWeatherContent: undefined });
    expect(initialData.weather?.rawWeatherFileName).toBeUndefined();
    expect(initialData.weather?.rawWeatherParsed).toBeUndefined();
  });
});
