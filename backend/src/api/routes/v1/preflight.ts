/**
 * Pre-flight weather check — issue #351.
 *
 * Read-only. Deliberately separate from POST /models/run: it must be callable
 * before the user has committed to anything, and it must never create state.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { ValidationError } from '../../../domain/errors/index.js';
import { preflightWeather } from '../../../application/services/WeatherPreflightService.js';
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
    const { timezone, timeRange, weather } = req.body ?? {};

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
    let ignition: Date;
    try {
      ignition = parseIsoToDate(start, 'timeRange.start');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ValidationError(message, [{ field: 'timeRange.start', message: 'unparseable' }]);
    }

    res.json(await preflightWeather(weather, ignition, timezone));
  } catch (error) {
    next(error);
  }
});

export default router;
