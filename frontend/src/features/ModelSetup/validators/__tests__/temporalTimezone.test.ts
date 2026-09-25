/**
 * The model's timezone must be chosen, not inherited — issue #368.
 *
 * The wizard pre-fills the timezone from `Intl.DateTimeFormat().resolvedOptions()`,
 * i.e. the operator's browser. That is a reasonable starting guess and a
 * terrible silent commitment: an operator in Winnipeg supporting an NWT
 * incident gets America/Winnipeg written into the model, every hour in the
 * run is shifted, and nothing anywhere says a zone was picked for them.
 *
 * The backend already refuses this — models.ts states "no runtime fallback"
 * and EnvironmentService throws on a fixed offset. Because the frontend
 * always supplies *a* value, that guard never fires. The validation exists
 * and is unreachable.
 *
 * So the value is kept, and the *provenance* is what gates the step: a zone
 * that was inferred must be acknowledged before the model can run. A zone
 * the operator actually chose passes silently.
 */

import { describe, it, expect } from 'vitest';
import { temporalValidator } from '../index.js';
import { DEFAULT_MODEL_SETUP_DATA } from '../../types/index.js';
import type { ModelSetupData } from '../../types/index.js';

function withTemporal(overrides: Partial<ModelSetupData['temporal']>): ModelSetupData {
  return {
    ...DEFAULT_MODEL_SETUP_DATA,
    temporal: {
      ...DEFAULT_MODEL_SETUP_DATA.temporal,
      startDate: '2023-06-19',
      startTime: '13:00',
      durationHours: 48,
      timezone: 'America/Edmonton',
      ...overrides,
    },
  };
}

const timezoneErrors = (data: ModelSetupData) =>
  temporalValidator(data).errors.filter((e) => e.field === 'timezone');

describe('temporal validator — timezone provenance (#368)', () => {
  it('blocks the step while the timezone is only inferred', () => {
    const errors = timezoneErrors(withTemporal({ timezoneSource: 'inferred' }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/confirm|detected|inferred/i);
  });

  it('names the zone it inferred, so the operator can tell if it is wrong', () => {
    // A message that says "confirm the timezone" without saying which one
    // gives the operator nothing to check.
    const errors = timezoneErrors(
      withTemporal({ timezone: 'America/Winnipeg', timezoneSource: 'inferred' }),
    );
    expect(errors[0].message).toContain('America/Winnipeg');
  });

  it('passes once the operator has confirmed or chosen the zone', () => {
    expect(timezoneErrors(withTemporal({ timezoneSource: 'chosen' }))).toHaveLength(0);
  });

  it('still requires a timezone at all', () => {
    const errors = timezoneErrors(withTemporal({ timezone: '', timezoneSource: 'chosen' }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('treats a missing provenance as inferred rather than trusted', () => {
    // Older drafts persisted before this field existed carry no source. The
    // safe reading is that nobody chose it.
    const errors = timezoneErrors(withTemporal({ timezoneSource: undefined }));
    expect(errors.length).toBeGreaterThan(0);
  });
});
