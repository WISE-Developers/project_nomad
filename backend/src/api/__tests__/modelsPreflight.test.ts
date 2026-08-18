/**
 * Pre-flight weather check — issue #351.
 *
 * A FireSTARR-format CSV that carries CFFDRS values on daily rows only satisfies
 * neither supported contract. Uploaded as firestarr_csv it parses to NaN on every
 * other row, and those NaNs reach the FireSTARR command line and segfault it.
 *
 * This endpoint answers one question before any job exists: does this file have
 * the daily-only shape, and if so what starting codes does it already contain?
 * It creates nothing — no model, no job, no sim directory.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import preflightRouter from '../routes/v1/preflight.js';

const ZONE = 'America/Edmonton';

const HEADER = 'Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI';

/** An hourly observation with no CFFDRS values — empty columns, as her file has. */
function blankRow(timestamp: string): string {
  return `0,${timestamp},0,24.4,46,10.2,222,,,,,,`;
}

/** The daily reading — the one row per day that carries the indices. */
function dailyRow(timestamp: string, ffmc: number, dmc: number, dc: number): string {
  return `0,${timestamp},0,23.8,61,7.5,217,${ffmc},${dmc},${dc},2,34.44,4.64`;
}

/** Vita's file: hourly observations, indices once a day at 19:06. */
const DAILY_ONLY_CSV = [
  HEADER,
  blankRow('2026-08-01 00:06:00'),
  dailyRow('2026-08-01 19:06:00', 81.66, 19.22, 412.67),
  blankRow('2026-08-02 00:06:00'),
  dailyRow('2026-08-02 19:06:00', 76.3, 18.52, 418.6),
  blankRow('2026-08-03 00:06:00'),
  dailyRow('2026-08-03 19:06:00', 84.65, 20.72, 424.9),
  blankRow('2026-08-04 00:06:00'),
  dailyRow('2026-08-04 19:06:00', 88.44, 23.66, 432.05),
].join('\n');

/** A conforming file — indices on every row. */
const FULLY_POPULATED_CSV = [
  HEADER,
  dailyRow('2026-08-01 00:06:00', 81.66, 19.22, 412.67),
  dailyRow('2026-08-01 01:06:00', 81.7, 19.3, 412.8),
].join('\n');

/** 2026-08-04 12:00 local MDT — her ignition. */
const IGNITION = '2026-08-04T18:00:00Z';

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    timezone: ZONE,
    timeRange: { start: IGNITION, end: '2026-08-07T18:00:00Z' },
    weather: { source: 'firestarr_csv', firestarrCsvContent: DAILY_ONLY_CSV },
    ...overrides,
  };
}

describe('POST /models/preflight', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api/v1', preflightRouter);
    app.use(
      (
        err: { httpStatus?: number; statusCode?: number; message: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(err.httpStatus ?? err.statusCode ?? 500).json({ error: err.message });
      },
    );
  });

  it("finds the codes already in vita's file and reports the daily-only shape", async () => {
    const res = await request(app).post('/api/v1/models/preflight').send(validBody());

    expect(res.status).toBe(200);
    expect(res.body.dailyOnlyCffdrs).toBe(true);
    expect(res.body.candidate).not.toBeNull();
    expect(res.body.candidate.ffmc).toBe(84.65);
    expect(res.body.candidate.dmc).toBe(20.72);
    expect(res.body.candidate.dc).toBe(424.9);
  });

  it('labels the reading so a human can recognise it in their own file', async () => {
    const res = await request(app).post('/api/v1/models/preflight').send(validBody());
    expect(res.body.candidate.localLabel).toBe('2026-08-03, 1900');
  });

  it('offers the reading before ignition, not the one after it', async () => {
    // Aug 4's 19:06 reading is later than her noon ignition. Using it would be
    // wrong for every morning fire.
    const res = await request(app).post('/api/v1/models/preflight').send(validBody());
    expect(res.body.candidate.ffmc).not.toBe(88.44);
  });

  it('reports nothing to fix for a conforming file', async () => {
    const res = await request(app)
      .post('/api/v1/models/preflight')
      .send(validBody({ weather: { source: 'firestarr_csv', firestarrCsvContent: FULLY_POPULATED_CSV } }));

    expect(res.status).toBe(200);
    expect(res.body.dailyOnlyCffdrs).toBe(false);
    expect(res.body.candidate).toBeNull();
  });

  it('reports nothing to fix when the source is not a FireSTARR CSV', async () => {
    // raw_weather already carries explicit starting codes. Nothing to detect.
    const res = await request(app)
      .post('/api/v1/models/preflight')
      .send(validBody({ weather: { source: 'raw_weather', rawWeatherContent: 'irrelevant' } }));

    expect(res.status).toBe(200);
    expect(res.body.dailyOnlyCffdrs).toBe(false);
    expect(res.body.candidate).toBeNull();
  });

  it('reports the shape but offers nothing when no reading precedes ignition', async () => {
    // The caller must not invent codes. It has to refuse.
    const res = await request(app)
      .post('/api/v1/models/preflight')
      .send(validBody({ timeRange: { start: '2026-08-01T12:00:00Z', end: '2026-08-04T12:00:00Z' } }));

    expect(res.status).toBe(200);
    expect(res.body.dailyOnlyCffdrs).toBe(true);
    expect(res.body.candidate).toBeNull();
  });

  it('survives a file full of NaN rather than failing on it', async () => {
    // The whole point. This endpoint exists to diagnose exactly the file that
    // breaks everything downstream, so it must not break on it itself.
    const res = await request(app).post('/api/v1/models/preflight').send(validBody());
    expect(res.status).toBe(200);
  });

  it('creates no model and no job — it only reads', async () => {
    const res = await request(app).post('/api/v1/models/preflight').send(validBody());
    expect(res.body.modelId).toBeUndefined();
    expect(res.body.jobId).toBeUndefined();
  });

  describe('fail-fast validation', () => {
    it('rejects a missing timezone', async () => {
      const body = validBody();
      delete (body as Record<string, unknown>).timezone;

      const res = await request(app).post('/api/v1/models/preflight').send(body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/timezone/i);
    });

    it('rejects a missing timeRange.start — there is no ignition without it', async () => {
      const res = await request(app)
        .post('/api/v1/models/preflight')
        .send(validBody({ timeRange: { end: '2026-08-07T18:00:00Z' } }));

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/start|ignition/i);
    });

    it('rejects a missing weather config', async () => {
      const body = validBody();
      delete (body as Record<string, unknown>).weather;

      const res = await request(app).post('/api/v1/models/preflight').send(body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/weather/i);
    });

    it('rejects an unparseable CSV with a message naming the problem', async () => {
      const res = await request(app)
        .post('/api/v1/models/preflight')
        .send(validBody({ weather: { source: 'firestarr_csv', firestarrCsvContent: 'not,a,weather,file\n1,2,3,4' } }));

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/column|parse|csv/i);
    });
  });
});

describe('route registration', () => {
  it('is reachable through the real v1 router, not just when mounted directly', async () => {
    // Guards the gap the suite above cannot see: every test there mounts
    // preflightRouter by hand, so they would all pass even if the app never
    // wired it in.
    const { default: v1Router } = await import('../routes/v1/index.js');

    const realApp = express();
    realApp.use(express.json({ limit: '50mb' }));
    realApp.use('/api/v1', v1Router);

    const res = await request(realApp).post('/api/v1/models/preflight').send(validBody());

    expect(res.status).not.toBe(404);
  });
});
