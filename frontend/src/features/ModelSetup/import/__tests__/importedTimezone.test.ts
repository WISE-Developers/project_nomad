/**
 * Where an imported timezone came from (refs #294, #368).
 *
 * #368 exists because a zone filled in from the operator's device is a guess,
 * and the operator is often nowhere near the fire — so the UI says "detected
 * from this device" and the validator makes confirming it a deliberate act.
 *
 * An imported zone is NOT a device guess. The .fgmj records the offset its
 * author worked in. Marking it 'inferred' told the operator something FALSE
 * and made them confirm recorded data; marking it 'chosen' would claim they
 * picked it. Hence a third provenance: 'imported'.
 *
 * Found by running the wizard, not by a unit test — the screen read
 * "Timezone -06:00 was detected from this device — not from the fire" for a
 * zone that came straight out of the job file.
 */

import { describe, it, expect } from 'vitest';
import { prefillFromImportPlan, type ImportedScenarioPlan } from '../fromImportPlan';
import { temporalValidator } from '../../validators';
import { DEFAULT_MODEL_SETUP_DATA, type ModelSetupData } from '../../types';
import lwf184 from './fixtures/lwf184-plan.json';

const plan = lwf184 as unknown as ImportedScenarioPlan;

describe('an imported timezone is not a device guess', () => {
  it('is marked as imported, not inferred and not chosen', () => {
    const { initialData } = prefillFromImportPlan(plan);
    expect(initialData.temporal?.timezoneSource).toBe('imported');
  });

  it('does not make the operator confirm a zone the file recorded', () => {
    const { initialData } = prefillFromImportPlan(plan);
    const data: ModelSetupData = {
      ...DEFAULT_MODEL_SETUP_DATA,
      ...initialData,
      temporal: { ...DEFAULT_MODEL_SETUP_DATA.temporal, ...initialData.temporal! },
    };
    const result = temporalValidator(data);
    const timezoneErrors = (result.errors ?? []).filter((e) => e.field === 'timezone');
    expect(timezoneErrors).toEqual([]);
  });

  it('still demands confirmation for a zone detected from the device', () => {
    // The #368 guard must stay intact for the case it was written for.
    const data: ModelSetupData = {
      ...DEFAULT_MODEL_SETUP_DATA,
      temporal: {
        ...DEFAULT_MODEL_SETUP_DATA.temporal,
        startDate: '2021-09-02',
        timezone: 'America/Edmonton',
        timezoneSource: 'inferred',
      },
    };
    const result = temporalValidator(data);
    const timezoneErrors = (result.errors ?? []).filter((e) => e.field === 'timezone');
    expect(timezoneErrors.length).toBeGreaterThan(0);
    expect(timezoneErrors[0].message).toMatch(/detected from this device/i);
  });
});
