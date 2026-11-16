/**
 * KnexResultRepository — the derived perimeter and arrival rows survive a round
 * trip (#536).
 *
 * WHY THIS EXISTS. #536 persists deterministic perimeters and the arrival raster
 * as result rows so MCP can retrieve them, and every test written for it mocked
 * the repository. A mocked repository cannot tell you whether the row you built
 * is the row that comes back, and `save`/`rowToResult` are a hand-kept pair — the
 * same gap `KnexModelRepository.timeRange.test.ts` was written for.
 *
 * It matters more here than usual because `save()` does something asymmetric:
 * it LIFTS `metadata.filePath` out of the metadata blob into the `file_path`
 * column, and writes `''` when there is none. A perimeter row has no file — its
 * geometry travels in the row — so it is the first row type in this codebase to
 * be stored with an empty `file_path`.
 *
 * As with the model-repository test beside it, the table is built by RUNNING THE
 * REAL MIGRATIONS, so this fails if the schema is wrong or the repository is
 * wrong, and cannot pass by agreeing with a hand-written fixture.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import knex, { Knex } from 'knex';
import { KnexResultRepository } from '../KnexResultRepository.js';
import { KnexModelRepository } from '../KnexModelRepository.js';
import {
  ModelResult,
  FireModel,
  createModelResultId,
  createFireModelId,
  OutputType,
  OutputFormat,
  EngineType,
  ModelStatus,
} from '../../../../domain/entities/index.js';

import { up as m001 } from '../../migrations/001_create_tables.js';
import { up as m002 } from '../../migrations/002_add_user_ownership.js';
import { up as m003 } from '../../migrations/003_add_model_config.js';
import { up as m006 } from '../../migrations/006_add_notes_column.js';
import { up as m007 } from '../../migrations/007_add_output_mode_column.js';
import { up as m009 } from '../../migrations/009_add_time_range_columns.js';

const MODEL_ID = createFireModelId('20cd8b4e-b4b3-4ff6-b126-0baa299b933e');

const PERIMETER_GEOJSON = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[[-114, 60], [-113.9, 60], [-113.9, 60.1], [-114, 60.1], [-114, 60]]],
  },
};

async function migratedDb(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  for (const up of [m001, m002, m003, m006, m007, m009]) {
    await up(db);
  }
  return db;
}

function perimeterRow(): ModelResult {
  return new ModelResult({
    id: createModelResultId(`perimeter-day170-${MODEL_ID}`),
    fireModelId: MODEL_ID,
    outputType: OutputType.Perimeter,
    format: OutputFormat.GeoJSON,
    metadata: {
      julianDay: 170,
      simulationDate: '2025-06-19',
      deterministic: true,
      geojson: PERIMETER_GEOJSON,
    },
  });
}

function arrivalRow(): ModelResult {
  return new ModelResult({
    id: createModelResultId(`arrival-time-${MODEL_ID}`),
    fireModelId: MODEL_ID,
    outputType: OutputType.ArrivalTime,
    format: OutputFormat.GeoTIFF,
    metadata: {
      filePath: `${MODEL_ID}/000_000001_172_arrival.tif`,
      julianDays: [170, 171, 172],
      deterministic: true,
    },
  });
}

describe('KnexResultRepository round-trips the #536 derived rows', () => {
  let db: Knex;
  let repo: KnexResultRepository;

  beforeEach(async () => {
    db = await migratedDb();
    repo = new KnexResultRepository(db);
    // model_results.model_id is a real FK to fire_models.id, so the parent row
    // has to exist. Written through the real model repository rather than a raw
    // insert, so this setup cannot drift from the schema either. The first run of
    // this file failed all seven cases on "FOREIGN KEY constraint failed" — the
    // control is what said so, because a broken harness and a found defect look
    // identical when only the assertions fail.
    await new KnexModelRepository(db).save(
      new FireModel({
        id: MODEL_ID,
        name: 'SS014-25 hindcast',
        engineType: EngineType.FireSTARR,
        status: ModelStatus.Completed,
      }),
    );
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('a perimeter row comes back with its geometry intact', async () => {
    await repo.save(perimeterRow());

    const rows = await repo.findByModelId(MODEL_ID);
    const perimeter = rows.find((r) => r.outputType === OutputType.Perimeter);

    expect(perimeter, 'the perimeter row should be found by model id').toBeDefined();
    expect(perimeter!.format).toBe(OutputFormat.GeoJSON);
    // The whole point of the row: an MCP caller reads this verbatim.
    expect(perimeter!.metadata.geojson).toEqual(PERIMETER_GEOJSON);
  });

  it('a perimeter row keeps the julianDay that identifies it, as a number', async () => {
    await repo.save(perimeterRow());

    const rows = await repo.findByModelId(MODEL_ID);
    const perimeter = rows.find((r) => r.outputType === OutputType.Perimeter);

    // The idempotency check compares this against the Julian days just derived.
    // A string here would make every read write a duplicate row.
    expect(perimeter!.metadata.julianDay).toBe(170);
    expect(typeof perimeter!.metadata.julianDay).toBe('number');
  });

  it('THE DEFECT: a perimeter row must not report a filePath, because it has no file', async () => {
    await repo.save(perimeterRow());

    const rows = await repo.findByModelId(MODEL_ID);
    const perimeter = rows.find((r) => r.outputType === OutputType.Perimeter);

    // `save()` writes '' into the notNullable file_path column, and rowToResult
    // puts the column straight back into metadata. get-results-data returns
    // metadata.filePath verbatim, so without this the tool reports a row
    // pointing at a path that is not a path.
    expect(perimeter!.metadata.filePath).toBeUndefined();
  });

  it('a perimeter row is never chosen as the simDir anchor', async () => {
    // getPerimeterGeoJSON and getArrivalRasterPath resolve the sim directory from
    // "the first row carrying a filePath". If a perimeter row satisfied that
    // test, simDir would be derived from a path that does not exist.
    await repo.save(perimeterRow());
    await repo.save(arrivalRow());

    const rows = await repo.findByModelId(MODEL_ID);
    const anchor = rows.find((r) => r.metadata.filePath as string | undefined);

    expect(anchor).toBeDefined();
    expect(anchor!.outputType).toBe(OutputType.ArrivalTime);
  });

  it('the arrival row keeps its relative filePath', async () => {
    await repo.save(arrivalRow());

    const rows = await repo.findByModelId(MODEL_ID);
    const arrival = rows.find((r) => r.outputType === OutputType.ArrivalTime);

    // Relative on purpose: resolveResultFilePath resolves it, and an absolute
    // path stored here would resolve to the wrong directory.
    expect(arrival!.metadata.filePath).toBe(`${MODEL_ID}/000_000001_172_arrival.tif`);
    expect(arrival!.metadata.julianDays).toEqual([170, 171, 172]);
  });

  it('saving twice under the same id does not duplicate the row', async () => {
    await repo.save(perimeterRow());
    await repo.save(perimeterRow());

    const rows = await repo.findByModelId(MODEL_ID);

    expect(rows.filter((r) => r.outputType === OutputType.Perimeter)).toHaveLength(1);
  });

  it('a probability row still reports its path — the control', async () => {
    // Proves the filePath assertion above is about empty paths and not about
    // filePath having stopped working.
    await repo.save(
      new ModelResult({
        id: createModelResultId(`prob-211-${MODEL_ID}`),
        fireModelId: MODEL_ID,
        outputType: OutputType.Probability,
        format: OutputFormat.GeoTIFF,
        metadata: { filePath: `${MODEL_ID}/probability_211_2025-07-30.tif`, julianDay: 211 },
      }),
    );

    const rows = await repo.findByModelId(MODEL_ID);
    const probability = rows.find((r) => r.outputType === OutputType.Probability);

    expect(probability!.metadata.filePath).toBe(`${MODEL_ID}/probability_211_2025-07-30.tif`);
  });
});
