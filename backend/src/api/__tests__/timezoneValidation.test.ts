/**
 * /models/run timezone fail-fast validation
 *
 * The route MUST reject requests that omit `timezone`. No silent runtime-zone
 * fallback (Papa's fail-fast policy + correctness with FireSTARR --tz).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import modelsRouter from '../routes/v1/models.js';
import { serveOnce } from '../../test/sharedServer.js';

describe('POST /models/run — timezone fail-fast', () => {
  let app: express.Application;
    /**
     * One server for this block instead of one per request (#480). `app` is
     * built once in beforeAll above and never reconfigured, and serveOnce is
     * lazy, so the listen happens on the first request — after beforeAll.
     */
  const api = serveOnce(() => app);

  beforeAll(() => {
    app = express();
    app.use(express.json());
    // Generic error handler so thrown ValidationErrors become JSON
    app.use('/api/v1', modelsRouter);
    app.use((err: Error & { httpStatus?: number; statusCode?: number; fieldErrors?: unknown }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(err.httpStatus ?? err.statusCode ?? 500).json({
        error: err.message,
        fieldErrors: err.fieldErrors,
      });
    });
  });

  const validBodyMinusTimezone = {
    name: 'TZ fail-fast test',
    engineType: 'firestarr',
    ignition: { type: 'point', coordinates: [-115.7, 60.82] },
    timeRange: {
      start: '2023-06-19T19:00:00Z',
      end: '2023-06-22T19:00:00Z',
    },
    weather: { source: 'firestarr_csv' },
    modelMode: 'deterministic',
    // timezone intentionally omitted
  };

  it('returns 400 when timezone field is missing', async () => {
    const res = await request(api())
      .post('/api/v1/models/run')
      .send(validBodyMinusTimezone);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/timezone/i);
  });

  it('returns 400 when timezone is empty string', async () => {
    const res = await request(api())
      .post('/api/v1/models/run')
      .send({ ...validBodyMinusTimezone, timezone: '' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/timezone/i);
  });
});
