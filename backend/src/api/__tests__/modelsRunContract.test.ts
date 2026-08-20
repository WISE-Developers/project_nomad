/**
 * POST /models/run rejects weather that FireSTARR cannot use — #339, #340, #341.
 *
 * Reproduces the CIFFC demo failures of 2026-08-19: four of six runs died with
 * FATAL: map::at about ten seconds in, every one with a weather series whose
 * first day began after noon. The user saw "Process exited with code 1"; the
 * actual reason was only in the container log.
 *
 * These must now come back as a 400 that says what is wrong, before any model,
 * job or simulation directory exists.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import modelsRouter from '../routes/v1/models.js';

const ZONE = 'America/Edmonton';
const HEADER = 'Scenario,Date,PREC,TEMP,RH,WS,WD,FFMC,DMC,DC,ISI,BUI,FWI';

/** Hourly rows across the given local hours of a day, all indices populated. */
function rows(day: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let h = from; h <= to; h++) {
    out.push(`0,${day} ${String(h).padStart(2, '0')}:00:00,0,20,45,10,180,85,30,200,5,40,10`);
  }
  return out;
}

function csv(...lines: string[][]): string {
  return [HEADER, ...lines.flat()].join('\n');
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    name: 'contract test',
    engineType: 'firestarr',
    ignition: { type: 'point', coordinates: [-113.5, 53.5] },
    timeRange: { start: '2026-08-04T18:00:00.000Z', end: '2026-08-05T18:00:00.000Z' },
    timezone: ZONE,
    weather: {
      source: 'firestarr_csv',
      firestarrCsvContent: csv(rows('2026-08-04', 0, 23), rows('2026-08-05', 0, 23)),
    },
    ...overrides,
  };
}

describe('POST /models/run — FireSTARR weather contract', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use('/api/v1', modelsRouter);
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

  it("rejects Danny's shape — a first day beginning after noon", async () => {
    const res = await request(app)
      .post('/api/v1/models/run')
      .send(
        body({
          weather: {
            source: 'firestarr_csv',
            firestarrCsvContent: csv(rows('2026-08-04', 17, 23), rows('2026-08-05', 0, 23)),
          },
          timeRange: { start: '2026-08-05T18:00:00.000Z', end: '2026-08-05T23:00:00.000Z' },
        }),
      );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/noon|12:00/i);
    expect(res.body.error).toMatch(/2026-08-04/);
  });

  it('says how to fix it rather than only that it failed', async () => {
    const res = await request(app)
      .post('/api/v1/models/run')
      .send(
        body({
          weather: {
            source: 'firestarr_csv',
            firestarrCsvContent: csv(rows('2026-08-04', 23, 23), rows('2026-08-05', 0, 23)),
          },
          timeRange: { start: '2026-08-05T18:00:00.000Z', end: '2026-08-05T23:00:00.000Z' },
        }),
      );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/trim|start the model/i);
  });

  it('rejects an ignition before the first noon record (#341)', async () => {
    // 09:00 local, with the first CFFDRS at noon that day.
    const res = await request(app)
      .post('/api/v1/models/run')
      .send(body({ timeRange: { start: '2026-08-04T15:00:00.000Z', end: '2026-08-05T18:00:00.000Z' } }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ignition/i);
  });

  it('rejects an ignition after the weather ends', async () => {
    const res = await request(app)
      .post('/api/v1/models/run')
      .send(body({ timeRange: { start: '2026-08-09T18:00:00.000Z', end: '2026-08-10T18:00:00.000Z' } }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ignition/i);
  });

  it('lets conforming weather THROUGH — the check must not reject everything', async () => {
    // Every other test here asserts a rejection, so all of them would still
    // pass if the check refused every request. This is the one that would not.
    const res = await request(app).post('/api/v1/models/run').send(body());

    expect(res.status).not.toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/noon|ignition is before/i);
  });

  it('reports an unreadable CSV as a client error naming the parser reason', async () => {
    const res = await request(app)
      .post('/api/v1/models/run')
      .send(body({ weather: { source: 'firestarr_csv', firestarrCsvContent: 'not,a,weather,file\n1,2,3,4' } }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/could not be read|column/i);
  });
});
