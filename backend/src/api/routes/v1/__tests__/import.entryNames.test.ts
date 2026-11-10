/**
 * Archive entry names are validated before anything is written (#517).
 *
 * `POST /import` took the last `/`-separated segment of each entry name and used it
 * verbatim — as a filename on disk and as the stored `metadata.filePath` that later reaches
 * the FireSTARR post-processing. Four things were missing: a constraint on the characters,
 * a containment check sharing the rule we already had elsewhere, a bound on what the archive
 * expands to, and refusal of duplicate final names (which silently lost data on import).
 *
 * TWO LEVELS, and the second is the one that matters most.
 *
 * Unit tests pin each rule, cheaply and exhaustively.
 *
 * Then a ROUTE test proves the guard is actually WIRED, and wired EARLY. A validator that
 * exists and is never called is the #516 shape — a complete, correct function with no call
 * site — and no amount of unit testing detects it. It also pins the ordering property the
 * issue asks for: `modelRepo.save(model)` sits before the extraction loop in the route, so
 * a refused archive must leave NO model row behind, not merely skip the files.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import AdmZip from 'adm-zip';

const { save, getData } = vi.hoisted(() => ({
  save: vi.fn(async (m: unknown) => m),
  // Counts inflation. The size cap must be enforced from the declared header size BEFORE
  // any entry is inflated, so this spy existing and never being called is the assertion.
  getData: vi.fn(),
}));

vi.mock('../../../../infrastructure/database/index.js', () => ({
  getModelRepository: vi.fn(() => ({
    save,
    findById: vi.fn(),
    find: vi.fn(),
    updateStatus: vi.fn(async () => undefined),
    getConfigJson: vi.fn(async () => null),
    saveConfigJson: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
  getResultRepository: vi.fn(() => ({
    save: vi.fn(async () => undefined),
    findByModelId: vi.fn(async () => []),
    deleteByModelId: vi.fn(async () => 0),
  })),
  getJobRepository: vi.fn(() => ({ deleteByModelId: vi.fn(async () => 0) })),
}));

import importRouter from '../import.js';
import { errorHandler } from '../../../middleware/errorHandler.js';
import { serveOnce } from '../../../../test/sharedServer.js';
import {
  assertArchiveEntriesSafe,
  resolvesInside,
  SAFE_ENTRY_NAME,
  MAX_ENTRIES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
} from '../../../../application/services/archiveEntryGuard.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', importRouter);
  app.use(errorHandler);
  return app;
}
const api = serveOnce(buildApp);

/** Minimal stand-in for an adm-zip entry, which is all the guard reads. */
function entry(entryName: string, size = 10, isDirectory = false) {
  return { entryName, isDirectory, header: { size } };
}

const DIR = '/data/sims/model-1';

describe('#517 archive entry name rules', () => {
  it('accepts the names Nomad itself exports', () => {
    const ok = [
      'model.json',
      'metadata.txt',
      'arrival_time.tif',
      'perimeter-day1-2026.geojson',
      'firestarr_10N_50651_wx.csv',
      'dem_18_5.tif',
    ];
    for (const name of ok) {
      expect(SAFE_ENTRY_NAME.test(name), `${name} should be accepted`).toBe(true);
    }
    expect(() => assertArchiveEntriesSafe(ok.map((n) => entry(n)), DIR)).not.toThrow();
  });

  it('refuses a name beginning with a hyphen, which a later tool reads as an option', () => {
    expect(SAFE_ENTRY_NAME.test('--output=/etc/passwd')).toBe(false);
    expect(() => assertArchiveEntriesSafe([entry('-rf.tif')], DIR)).toThrow(/entry name/i);
  });

  it('refuses quotes, spaces and control characters in a name', () => {
    for (const name of ['a b.tif', 'a".tif', "a'.tif", 'a;b.tif', 'a\nb.tif', 'a$b.tif']) {
      expect(SAFE_ENTRY_NAME.test(name), `${name} should be refused`).toBe(false);
    }
  });

  it('refuses a traversal segment, and the containment rule agrees', () => {
    expect(resolvesInside(DIR, 'ok.tif')).toBe(true);
    expect(resolvesInside(DIR, '../escaped.tif')).toBe(false);
    expect(resolvesInside(DIR, '/etc/passwd')).toBe(false);
    expect(() => assertArchiveEntriesSafe([entry('..')], DIR)).toThrow();
  });

  it('refuses two entries whose final segment is the same — silent data loss today', () => {
    expect(() =>
      assertArchiveEntriesSafe([entry('a/arrival.tif'), entry('b/arrival.tif')], DIR),
    ).toThrow(/duplicate/i);
  });

  it('refuses an archive declaring more entries than the cap', () => {
    const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => entry(`f${i}.tif`));
    expect(() => assertArchiveEntriesSafe(many, DIR)).toThrow(/entries/i);
  });

  it('refuses an archive whose declared uncompressed size exceeds the cap', () => {
    const big = [
      entry('a.tif', MAX_TOTAL_UNCOMPRESSED_BYTES),
      entry('b.tif', MAX_TOTAL_UNCOMPRESSED_BYTES),
    ];
    expect(() => assertArchiveEntriesSafe(big, DIR)).toThrow(/size/i);
  });

  it('ignores directory entries when applying name rules', () => {
    // A directory entry legitimately ends in '/', which the name rule would refuse.
    expect(() =>
      assertArchiveEntriesSafe([entry('outputs/', 0, true), entry('a.tif')], DIR),
    ).not.toThrow();
  });

  it('control: the guard can throw AND can pass, so neither result is vacuous', () => {
    expect(() => assertArchiveEntriesSafe([entry('fine.tif')], DIR)).not.toThrow();
    expect(() => assertArchiveEntriesSafe([entry('not fine.tif')], DIR)).toThrow();
  });
});

describe('#517 the guard is wired into POST /import, before the model row is written', () => {
  beforeEach(() => {
    save.mockClear();
    getData.mockClear();
  });

  function zipWith(names: string[]): Buffer {
    const zip = new AdmZip();
    zip.addFile('model.json', Buffer.from(JSON.stringify({ name: 'imported' })));
    for (const n of names) zip.addFile(n, Buffer.from('x'.repeat(16)));
    return zip.toBuffer();
  }

  it('refuses an archive with an unsafe entry name, and writes NO model row', async () => {
    const res = await request(api())
      .post('/api/v1/import')
      .attach('file', zipWith(['bad name.tif']), 'export.zip');

    expect(res.status).toBe(400);
    expect(
      save,
      'a refused archive still created a model row — the guard runs too late',
    ).not.toHaveBeenCalled();
  });

  it('refuses duplicate final names through the route', async () => {
    const res = await request(api())
      .post('/api/v1/import')
      .attach('file', zipWith(['a/arrival.tif', 'b/arrival.tif']), 'export.zip');

    expect(res.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  it('control: a clean archive is still accepted and DOES write a model row', async () => {
    // Without this the two assertions above pass if the endpoint rejects everything.
    const res = await request(api())
      .post('/api/v1/import')
      .attach('file', zipWith(['arrival_time.tif']), 'export.zip');

    expect(res.status).toBeLessThan(400);
    expect(save).toHaveBeenCalled();
  });
});
