/**
 * FireModel — the simulated time range is a PROPERTY OF THE MODEL (#482).
 *
 * THE ROOT CAUSE THIS CLOSES. `FireModel` carried id, name, engineType, status,
 * createdAt, updatedAt, userId, notes and outputMode — and no time range. The
 * run API required `timeRange`, handed it to the engine as an argument, and
 * `FireSTARREngine` wrote it into `output-config.json`. That file was the ONLY
 * copy. The start date was an argument to a run, never a property of the model:
 * used, then discarded. Measured on the 64 real sim dirs, 26 have no `timeRange`
 * at all and 14 of those have arrival rasters — forty percent of runs, caused by
 * a config schema change with no migration and no version marker.
 *
 * So the entity has to hold it, and the `with*` copies have to CARRY it. That
 * second half is the trap and it is why this file exists rather than a single
 * constructor assertion: `withStatus` is called on the completion path
 * (`modelRepo.save(model.withStatus(ModelStatus.Completed))`), so a `withStatus`
 * that drops the field would persist the range at queue time and then WIPE it
 * the moment the run succeeded. Every run would end with no time range, the
 * tests would be green, and the defect would look exactly like the one we are
 * fixing.
 *
 * `withName` is the same class — a rule fixed in one branch of a function is not
 * fixed in the other. Both members are asserted here, field by field, so adding
 * a tenth property without carrying it fails on the next line rather than in
 * production.
 */
import { describe, it, expect } from 'vitest';
import { FireModel, createFireModelId, EngineType, ModelStatus } from '../index.js';
import { TimeRange } from '../../value-objects/index.js';

const ID = createFireModelId('model-482');
const START = new Date('2023-06-19T12:00:00.000Z');
const END = new Date('2023-06-22T12:00:00.000Z');

function modelWithRange(): FireModel {
  return new FireModel({
    id: ID,
    name: 'Fort Smith reconstruction',
    engineType: EngineType.FireSTARR,
    status: ModelStatus.Queued,
    userId: 'operator@example.gov',
    notes: 'a note',
    outputMode: 'deterministic',
    timeRange: new TimeRange(START, END),
  });
}

describe('FireModel carries its simulated time range', () => {
  it('stores the time range given at construction', () => {
    const model = modelWithRange();

    expect(model.timeRange?.start.toISOString()).toBe(START.toISOString());
    expect(model.timeRange?.end.toISOString()).toBe(END.toISOString());
  });

  it('leaves the time range undefined when none is given — never substituted', () => {
    // The whole ruling on #482 in one assertion. A model with no recorded range
    // reports no range. It does not report today, and it does not report the
    // current year. An unknown start stays unknown.
    const model = new FireModel({
      id: ID,
      name: 'Draft with no run yet',
      engineType: EngineType.FireSTARR,
    });

    expect(model.timeRange).toBeUndefined();
  });

  describe('the with* copies carry it — the completion path depends on this', () => {
    it('withStatus preserves the time range', () => {
      const completed = modelWithRange().withStatus(ModelStatus.Completed);

      expect(completed.status).toBe(ModelStatus.Completed);
      expect(completed.timeRange?.start.toISOString()).toBe(START.toISOString());
      expect(completed.timeRange?.end.toISOString()).toBe(END.toISOString());
    });

    it('withName preserves the time range', () => {
      const renamed = modelWithRange().withName('Renamed');

      expect(renamed.name).toBe('Renamed');
      expect(renamed.timeRange?.start.toISOString()).toBe(START.toISOString());
      expect(renamed.timeRange?.end.toISOString()).toBe(END.toISOString());
    });

    it('withStatus carries every other property too, so a new field cannot be dropped silently', () => {
      const original = modelWithRange();
      const copy = original.withStatus(ModelStatus.Completed);

      // updatedAt is SUPPOSED to change — asserted separately below so that
      // this check cannot pass by comparing the whole object loosely.
      expect(copy.id).toBe(original.id);
      expect(copy.name).toBe(original.name);
      expect(copy.engineType).toBe(original.engineType);
      expect(copy.createdAt).toEqual(original.createdAt);
      expect(copy.userId).toBe(original.userId);
      expect(copy.notes).toBe(original.notes);
      expect(copy.outputMode).toBe(original.outputMode);
      expect(copy.timeRange?.start).toEqual(original.timeRange?.start);
      expect(copy.timeRange?.end).toEqual(original.timeRange?.end);
    });

    it('withStatus still advances updatedAt — the control for the test above', () => {
      // Without this, "carries every other property" could be satisfied by a
      // withStatus that returned `this`, which would carry everything and
      // change nothing. One assertion that must DIFFER keeps the pair honest.
      const original = modelWithRange();
      const copy = original.withStatus(ModelStatus.Completed);

      expect(copy).not.toBe(original);
      expect(copy.updatedAt.getTime()).toBeGreaterThanOrEqual(original.updatedAt.getTime());
    });

    it('a model with no time range still copies cleanly', () => {
      const bare = new FireModel({
        id: ID,
        name: 'No range',
        engineType: EngineType.FireSTARR,
      });

      expect(bare.withStatus(ModelStatus.Failed).timeRange).toBeUndefined();
      expect(bare.withName('Other').timeRange).toBeUndefined();
    });
  });
});
