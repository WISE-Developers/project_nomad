/**
 * #432 — the extent warning must reach the operator BEFORE they hit run.
 *
 * Franco, 2026-10-12: "yes before they hit run!"
 *
 * The 180 km warning already existed and was emitted into the execution log,
 * which means an operator saw it only once the run was under way. Too late to
 * act on: by then the choice of whether to split the fire into separate models
 * has already been made for them.
 *
 * `POST /models/preflight` is the right home rather than a new endpoint — it
 * already runs before any job exists, creates nothing, and already gates the
 * wizard through useWeatherPreflightGate. Extending it keeps one pre-run check
 * instead of two that can disagree about whether a run is advisable.
 *
 * NOTE THE ASYMMETRY WITH WEATHER: a daily-only CSV is an error that blocks.
 * This is a warning that does not. The response must keep them distinguishable,
 * because a caller that treated them alike would either block a legal 200 km
 * fire or let a segfaulting CSV through.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import preflightRouter from '../routes/v1/preflight.js';
import { errorHandler } from '../middleware/errorHandler.js';

const ZONE = 'America/Edmonton';
const M_PER_DEGREE_LAT = 111_320;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', preflightRouter);
  app.use(errorHandler);
  return app;
}

/** A square ignition polygon of a given north-south span, at a Canadian latitude. */
function squareIgnition(spanM: number, lat = 55) {
  const dLat = spanM / M_PER_DEGREE_LAT;
  const dLon = spanM / (M_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  return {
    type: 'polygon',
    coordinates: [
      [
        [-114, lat],
        [-114 + dLon, lat],
        [-114 + dLon, lat + dLat],
        [-114, lat + dLat],
        [-114, lat],
      ],
    ],
  };
}

function body(extra: Record<string, unknown> = {}) {
  return {
    timezone: ZONE,
    timeRange: { start: '2026-06-15T14:00:00Z', end: '2026-06-18T14:00:00Z' },
    weather: { source: 'spotwx' },
    ...extra,
  };
}

describe('POST /models/preflight — extent warning (#432)', () => {
  describe('the control: the endpoint still answers at all', () => {
    it('responds 200 with no ignition supplied', async () => {
      // Backwards compatibility is the control here. An existing caller that
      // sends no geometry must keep working — if this 400s, every assertion
      // below is about an endpoint nobody can call.
      const res = await request(buildApp()).post('/api/v1/models/preflight').send(body());
      expect(res.status).toBe(200);
    });
  });

  describe('a fire inside the warning band', () => {
    it('reports no extent warning for an ordinary fire', async () => {
      const res = await request(buildApp())
        .post('/api/v1/models/preflight')
        .send(body({ ignition: squareIgnition(50_000) }));

      expect(res.status).toBe(200);
      expect(res.body.extent).toBeDefined();
      expect(res.body.extent.nearLimit).toBe(false);
      expect(res.body.extent.warning).toBeUndefined();
    });

    it('reports no warning at 115 km, the largest span we have measured', async () => {
      const res = await request(buildApp())
        .post('/api/v1/models/preflight')
        .send(body({ ignition: squareIgnition(115_000) }));

      expect(res.body.extent.nearLimit).toBe(false);
    });
  });

  describe('a fire in the warning band', () => {
    it('returns the warning before any job exists', async () => {
      const res = await request(buildApp())
        .post('/api/v1/models/preflight')
        .send(body({ ignition: squareIgnition(200_000) }));

      expect(res.status).toBe(200);
      expect(res.body.extent.nearLimit).toBe(true);
      expect(typeof res.body.extent.warning).toBe('string');
      expect(res.body.extent.warning).toMatch(/409\.6 km/);
    });

    it('does not block: the warning is advisory and the status stays 200', async () => {
      // The distinction from the weather error. A 200 km fire is legal.
      const res = await request(buildApp())
        .post('/api/v1/models/preflight')
        .send(body({ ignition: squareIgnition(200_000) }));

      expect(res.status).toBe(200);
    });
  });

  describe('a fire over the hard limit', () => {
    it('says the run cannot proceed, distinctly from the advisory warning', async () => {
      const res = await request(buildApp())
        .post('/api/v1/models/preflight')
        .send(body({ ignition: squareIgnition(500_000) }));

      expect(res.status).toBe(200);
      // #491: assert the block EXISTS before reaching into it. This line once
      // failed in a full-suite run with `res.body.extent` undefined on a 200,
      // and `.withinLimit` on undefined throws a TypeError that discards the
      // response — so the single sighting of that failure tells us nothing
      // about what the server actually sent. `toHaveProperty` prints the body.
      // The assertions are unchanged; only what they report on failure is.
      expect(res.body, 'a 200 from preflight must carry an extent block').toHaveProperty('extent');
      expect(res.body.extent.withinLimit).toBe(false);
      expect(typeof res.body.extent.reason).toBe('string');
      // A refusal must not arrive wearing the advisory field, or the wizard
      // will let the operator press on.
      expect(res.body.extent.warning).toBeUndefined();
    });
  });

  describe('no geometry supplied', () => {
    it('says it did not measure, rather than reporting a clean measurement', async () => {
      // The quartet, at this boundary. "No ignition was sent" and "an ignition
      // was sent and is fine" must not render identically — a wizard that read
      // the second from the first would show a green check for a check that
      // never ran.
      const res = await request(buildApp()).post('/api/v1/models/preflight').send(body());

      expect(res.body.extent).toBeDefined();
      expect(res.body.extent.measured).toBe(false);
      expect(res.body.extent.nearLimit).toBe(false);
      expect(res.body.extent.warning).toBeUndefined();
    });

    it('reports measured:true when a geometry WAS measured', async () => {
      // The other direction. Without this, `measured:false` everywhere passes.
      const res = await request(buildApp())
        .post('/api/v1/models/preflight')
        .send(body({ ignition: squareIgnition(50_000) }));

      expect(res.body.extent.measured).toBe(true);
    });
  });
});

describe('POST /models/preflight — multi-ignition extent (#294 lesson)', () => {
  const M = 111_320;
  function pointAt(lon: number, lat: number) {
    return { type: 'point', coordinates: [lon, lat] };
  }

  it('measures across ALL ignitions, not the first', async () => {
    // Two small points 250 km apart. Each alone is nothing; the grid has to
    // cover both. Taking features[0] would report a clean 0 km span — the
    // unsafe direction, because the engine crops in silence.
    const dLon = 250_000 / (M * Math.cos((55 * Math.PI) / 180));
    const res = await request(buildApp())
      .post('/api/v1/models/preflight')
      .send(
        body({
          ignitions: [pointAt(-114, 55), pointAt(-114 + dLon, 55)],
        }),
      );

    expect(res.body.extent.measured).toBe(true);
    expect(res.body.extent.nearLimit).toBe(true);
    expect(res.body.extent.warning).toMatch(/409\.6 km/);
  });

  it('is the control: two NEARBY ignitions stay silent', async () => {
    // Without this, an implementation that always warns on an array passes.
    const res = await request(buildApp())
      .post('/api/v1/models/preflight')
      .send(body({ ignitions: [pointAt(-114, 55), pointAt(-113.9, 55.1)] }));

    expect(res.body.extent.measured).toBe(true);
    expect(res.body.extent.nearLimit).toBe(false);
  });
});
