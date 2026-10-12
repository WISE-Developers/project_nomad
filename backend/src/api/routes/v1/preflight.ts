/**
 * Pre-flight weather check — issue #351.
 *
 * Read-only. Deliberately separate from POST /models/run: it must be callable
 * before the user has committed to anything, and it must never create state.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { ValidationError } from '../../../domain/errors/index.js';
import { preflightWeather } from '../../../application/services/WeatherPreflightService.js';
import { checkSimulationExtent } from '../../../infrastructure/firestarr/simulationExtent.js';
import { SpatialGeometry, GeometryType } from '../../../domain/entities/index.js';
import { parseIsoToDate } from '../../../shared/dateParsing.js';
import { IANAZone } from 'luxon';

const router = Router();

/**
 * @openapi
 * /models/preflight:
 *   post:
 *     summary: Inspect a weather file before running a model
 *     description: >
 *       Detects the daily-only CFFDRS shape and, when found, returns the
 *       starting codes already present in the file. Creates nothing.
 *     responses:
 *       200:
 *         description: Inspection result
 *       400:
 *         description: Missing required field, or an unparseable CSV
 */
router.post('/models/preflight', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { timezone, timeRange, weather, ignition, ignitions } = req.body ?? {};

    if (typeof timezone !== 'string' || timezone.trim() === '') {
      throw new ValidationError('timezone is required (IANA identifier)', [
        { field: 'timezone', message: 'required' },
      ]);
    }

    // Reject an unresolvable zone here so it surfaces as a client error rather
    // than a 500 from deeper in the stack (#353).
    if (!IANAZone.isValidZone(timezone)) {
      throw new ValidationError(`Unknown IANA timezone: ${timezone}`, [
        { field: 'timezone', message: 'unknown zone' },
      ]);
    }

    if (weather === null || typeof weather !== 'object') {
      throw new ValidationError('weather config is required', [
        { field: 'weather', message: 'required' },
      ]);
    }

    // There is no separate ignition field on a run request — timeRange.start
    // is the ignition instant. See #351.
    const start = timeRange?.start;
    if (typeof start !== 'string' || start.trim() === '') {
      throw new ValidationError('timeRange.start is required — it is the ignition time', [
        { field: 'timeRange.start', message: 'required' },
      ]);
    }

    // parseIsoToDate is the house parser: it rejects bare timestamps that carry
    // no UTC offset rather than guessing a zone for them.
    let ignitionInstant: Date;
    try {
      ignitionInstant = parseIsoToDate(start, 'timeRange.start');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ValidationError(message, [{ field: 'timeRange.start', message: 'unparseable' }]);
    }

    const weatherResult = await preflightWeather(weather, ignitionInstant, timezone);

    res.json({ ...weatherResult, extent: extentResult(ignition, ignitions) });
  } catch (error) {
    next(error);
  }
});

/**
 * The #432 extent check, as a pre-run answer rather than an execution-log line.
 *
 * `measured` is the field that keeps this honest. "No ignition was sent" and
 * "an ignition was sent and is comfortably small" are different facts that would
 * otherwise render identically — and a wizard reading the second from the first
 * would show a cleared check for a check that never ran. Same shape as the
 * engine-outage/empty-result confusion: the absence must not be reported in the
 * same words as the nothing.
 *
 * A warning NEVER accompanies a refusal. `withinLimit: false` is the operative
 * fact there, and a wizard that surfaced the advisory text alongside it would
 * invite the operator to press on through a run that will be silently cropped.
 */
function extentResult(ignition: unknown, ignitions?: unknown): {
  measured: boolean;
  withinLimit: boolean;
  nearLimit: boolean;
  widthM: number;
  heightM: number;
  reason?: string;
  warning?: string;
} {
  // A multi-ignition run is measured across ALL of its ignitions, not the
  // first. Taking features[0] would understate the span of a fire drawn as
  // several fronts — and understating an extent is the unsafe direction: the
  // engine crops silently, so the operator would be reassured by a number that
  // describes one piece of their fire. #294 fixed the same first-feature
  // assumption on the execution path.
  const candidates = Array.isArray(ignitions) ? ignitions : [ignition];
  const geometries = candidates
    .map((candidate) => toGeometry(candidate))
    .filter((geometry): geometry is SpatialGeometry => geometry !== undefined);

  if (geometries.length === 0) {
    return { measured: false, withinLimit: true, nearLimit: false, widthM: 0, heightM: 0 };
  }

  if (geometries.length === 1) {
    return { measured: true, ...checkSimulationExtent(geometries[0]) };
  }

  // The union bounding box: what the grid would actually have to cover.
  const boxes = geometries.map((geometry) => geometry.getBoundingBox());
  const union = new SpatialGeometry({
    type: GeometryType.Polygon,
    coordinates: [
      (() => {
        const minLon = Math.min(...boxes.map((b) => b[0]));
        const minLat = Math.min(...boxes.map((b) => b[1]));
        const maxLon = Math.max(...boxes.map((b) => b[2]));
        const maxLat = Math.max(...boxes.map((b) => b[3]));
        return [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ] as [number, number][];
      })(),
    ],
  });

  return { measured: true, ...checkSimulationExtent(union) };
}

/**
 * Builds a geometry from the request's ignition, or returns undefined when none
 * was supplied. An unrecognised type returns undefined rather than throwing:
 * preflight exists to inform a decision, and failing the whole pre-run check
 * because a geometry type was unfamiliar would withhold the weather answer too.
 * The run request itself validates the geometry properly.
 */
function toGeometry(ignition: unknown): SpatialGeometry | undefined {
  if (ignition === null || typeof ignition !== 'object') return undefined;
  const { type, coordinates } = ignition as { type?: unknown; coordinates?: unknown };
  if (typeof type !== 'string' || coordinates === undefined) return undefined;

  try {
    switch (type) {
      case 'point':
        return new SpatialGeometry({
          type: GeometryType.Point,
          coordinates: coordinates as [number, number],
        });
      case 'linestring':
        return new SpatialGeometry({
          type: GeometryType.LineString,
          coordinates: coordinates as [number, number][],
        });
      case 'polygon':
        return new SpatialGeometry({
          type: GeometryType.Polygon,
          coordinates: coordinates as [number, number][][],
        });
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

export default router;
