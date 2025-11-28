/**
 * Results Routes
 *
 * Handles result file serving: preview (GeoJSON contours) and download (raw files).
 */

import { Router } from 'express';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { basename } from 'path';
import { asyncHandler } from '../../middleware/index.js';
import { NotFoundError } from '../../../domain/errors/index.js';
import { createModelResultId, OutputFormat } from '../../../domain/entities/index.js';
import { getModelResultsService } from '../../../application/services/index.js';
import { getFireSTARREngine, generateContours } from '../../../infrastructure/firestarr/index.js';

const router = Router();

/**
 * @openapi
 * /results/{resultId}/preview:
 *   get:
 *     summary: Get result preview as GeoJSON
 *     description: Returns GeoJSON contours for displaying probability rasters on a map
 *     tags: [Results]
 *     parameters:
 *       - in: path
 *         name: resultId
 *         required: true
 *         schema:
 *           type: string
 *         description: Result ID
 *     responses:
 *       200:
 *         description: GeoJSON FeatureCollection of contours
 *         content:
 *           application/geo+json:
 *             schema:
 *               type: object
 *               properties:
 *                 type:
 *                   type: string
 *                   enum: [FeatureCollection]
 *                 features:
 *                   type: array
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/results/:resultId/preview',
  asyncHandler(async (req, res) => {
    const { resultId } = req.params;
    const typedResultId = createModelResultId(resultId);

    // Get results service
    const engine = getFireSTARREngine();
    const resultsService = getModelResultsService(engine);

    // Get result
    const stored = resultsService.getResultById(typedResultId);
    if (!stored) {
      throw new NotFoundError('Result', resultId);
    }

    const filePath = stored.result.metadata.filePath as string | undefined;
    if (!filePath || !existsSync(filePath)) {
      throw new NotFoundError('Result file', resultId);
    }

    // Generate contours from GeoTIFF
    const contours = await generateContours(filePath);

    res.setHeader('Content-Type', 'application/geo+json');
    res.json(contours);
  })
);

/**
 * @openapi
 * /results/{resultId}/download:
 *   get:
 *     summary: Download result file
 *     description: Downloads the raw result file (GeoTIFF, etc.)
 *     tags: [Results]
 *     parameters:
 *       - in: path
 *         name: resultId
 *         required: true
 *         schema:
 *           type: string
 *         description: Result ID
 *     responses:
 *       200:
 *         description: Raw file download
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/results/:resultId/download',
  asyncHandler(async (req, res) => {
    const { resultId } = req.params;
    const typedResultId = createModelResultId(resultId);

    // Get results service
    const engine = getFireSTARREngine();
    const resultsService = getModelResultsService(engine);

    // Get result
    const stored = resultsService.getResultById(typedResultId);
    if (!stored) {
      throw new NotFoundError('Result', resultId);
    }

    const filePath = stored.result.metadata.filePath as string | undefined;
    if (!filePath || !existsSync(filePath)) {
      throw new NotFoundError('Result file', resultId);
    }

    // Get file stats
    const stats = await stat(filePath);
    const filename = basename(filePath);

    // Determine content type based on format
    let contentType = 'application/octet-stream';
    if (stored.result.format === OutputFormat.GeoTIFF) {
      contentType = 'image/tiff';
    } else if (stored.result.format === OutputFormat.GeoJSON) {
      contentType = 'application/geo+json';
    } else if (stored.result.format === OutputFormat.KML) {
      contentType = 'application/vnd.google-earth.kml+xml';
    }

    // Set headers for download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Stream the file
    const stream = createReadStream(filePath);
    stream.pipe(res);
  })
);

export default router;
