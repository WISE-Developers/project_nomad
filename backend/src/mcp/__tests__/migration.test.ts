/**
 * Migration 003 + Repository Config Methods — Unit Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import knex, { Knex } from 'knex';
import { up, down } from '../../infrastructure/database/migrations/003_add_model_config.js';
import { KnexModelRepository } from '../../infrastructure/database/knex/KnexModelRepository.js';
import { FireModel, createFireModelId, EngineType, ModelStatus } from '../../domain/entities/index.js';

// ─── Helpers ─────────────────────────────────────────────────────

async function createInMemoryDb(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  // Create the base fire_models table (mirrors 001_create_tables)
  await db.schema.createTable('fire_models', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('engine_type').notNullable();
    table.string('status').notNullable();
    table.timestamp('created_at').notNullable();
    table.timestamp('updated_at').notNullable();
    table.string('user_id').nullable();
  });

  return db;
}

function makeModel(id: string): FireModel {
  return new FireModel({
    id: createFireModelId(id),
    name: 'Test Model',
    engineType: EngineType.FireSTARR,
    status: ModelStatus.Draft,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// ─── Migration Tests ──────────────────────────────────────────────

describe('003_add_model_config migration', () => {
  let db: Knex;

  beforeEach(async () => {
    db = await createInMemoryDb();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('up() adds config_json column', async () => {
    const beforeUp = await db.schema.hasColumn('fire_models', 'config_json');
    expect(beforeUp).toBe(false);

    await up(db);

    const afterUp = await db.schema.hasColumn('fire_models', 'config_json');
    expect(afterUp).toBe(true);
  });

  it('up() is idempotent — running twice does not throw', async () => {
    await up(db);
    await expect(up(db)).resolves.toBeUndefined();
  });

  it('down() removes config_json column', async () => {
    await up(db);
    await down(db);

    const hasColumn = await db.schema.hasColumn('fire_models', 'config_json');
    expect(hasColumn).toBe(false);
  });

  it('down() is safe when column does not exist', async () => {
    await expect(down(db)).resolves.toBeUndefined();
  });
});

// ─── Repository Config Method Tests ──────────────────────────────

describe('KnexModelRepository config methods', () => {
  let db: Knex;
  let repo: KnexModelRepository;

  beforeEach(async () => {
    db = await createInMemoryDb();
    await up(db);
    repo = new KnexModelRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('getConfigJson returns null for a model with no config', async () => {
    const model = makeModel('model-no-config');
    await repo.save(model);

    const result = await repo.getConfigJson(model.id);
    expect(result).toBeNull();
  });

  it('saveConfigJson persists config and getConfigJson retrieves it', async () => {
    const model = makeModel('model-with-config');
    await repo.save(model);

    const config = {
      ignitionPoints: [{ lat: 62.5, lng: -114.3 }],
      weather: { temperature: 30, rh: 20, windSpeed: 25, windDirection: 270, precipitation: 0 },
      fuelType: 'C-2',
      simulationTime: { startTime: '2026-06-15T14:00:00Z', durationHours: 6 },
    };

    await repo.saveConfigJson(model.id, config);
    const retrieved = await repo.getConfigJson(model.id);

    expect(retrieved).toEqual(config);
  });

  it('saveConfigJson overwrites existing config', async () => {
    const model = makeModel('model-overwrite');
    await repo.save(model);

    await repo.saveConfigJson(model.id, { version: 1, fuelType: 'C-1' });
    await repo.saveConfigJson(model.id, { version: 2, fuelType: 'C-2' });

    const retrieved = await repo.getConfigJson(model.id);
    expect(retrieved).toEqual({ version: 2, fuelType: 'C-2' });
  });

  it('configs for different models are independent', async () => {
    const modelA = makeModel('model-a');
    const modelB = makeModel('model-b');
    await repo.save(modelA);
    await repo.save(modelB);

    await repo.saveConfigJson(modelA.id, { fuelType: 'C-1' });
    await repo.saveConfigJson(modelB.id, { fuelType: 'C-3' });

    expect(await repo.getConfigJson(modelA.id)).toEqual({ fuelType: 'C-1' });
    expect(await repo.getConfigJson(modelB.id)).toEqual({ fuelType: 'C-3' });
  });
});
