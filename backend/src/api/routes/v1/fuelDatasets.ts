/**
 * GET /api/v1/fuel-datasets — installed fuel vintages (#319).
 *
 * Lets the setup and results views tell the user which fuel dataset a run
 * uses. Pass ?modelYear=YYYY to also get how that year resolves, including
 * whether lookup fell back to default/ — that fallback is silent inside the
 * engine, and silence is what the user needs protecting from.
 *
 * Vintage = RUN year (start-of-year fuel state); a run in year N uses
 * dataset N. Not off-by-one.
 */

import { Router } from 'express';
import type { IFuelDatasetCatalog } from '../../../application/interfaces/index.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';

export default function fuelDatasetsRouter(catalog: IFuelDatasetCatalog): Router {
  const router = Router();

  router.get(
    '/fuel-datasets',
    asyncHandler(async (req, res) => {
      const rawYear = req.query.modelYear;

      let modelYear: number | undefined;
      if (rawYear !== undefined) {
        modelYear = Number(rawYear);
        // Reject rather than ignore: silently dropping the year would return a
        // dataset list that looks like an answer to a question never asked.
        if (!Number.isInteger(modelYear)) {
          return res.status(400).json({
            error: 'modelYear must be a four-digit year',
            received: String(rawYear),
          });
        }
      }

      const datasets = await catalog.listInstalled();
      const resolved =
        modelYear === undefined ? undefined : await catalog.resolveForYear(modelYear);

      return res.json({ datasets, resolved });
    })
  );

  return router;
}
