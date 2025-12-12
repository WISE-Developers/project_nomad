/**
 * Results Routes
 *
 * Handles result file serving: preview (GeoJSON contours), tiles (raster PNG), and download (raw files).
 */

import { Router } from 'express';
import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { basename } from 'path';
import { asyncHandler } from '../../middleware/index.js';
import { NotFoundError } from '../../../domain/errors/index.js';
import { createModelResultId, OutputFormat } from '../../../domain/entities/index.js';
import { getModelResultsService } from '../../../application/services/index.js';
import { getFireSTARREngine, generateContours, generateRasterTile, getRasterBounds, type BreaksMode } from '../../../infrastructure/firestarr/index.js';
import { resolveResultFilePath } from '../../../infrastructure/firestarr/FireSTARRInputGenerator.js';

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
 *       - in: query
 *         name: mode
 *         schema:
 *           type: string
 *           enum: [static, dynamic]
 *           default: dynamic
 *         description: |
 *           Breaks mode for color classification:
 *           - static: Fixed 10% intervals (FireSTARR standard symbology)
 *           - dynamic: Quantile breaks calculated from data
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
    const { mode = 'dynamic' } = req.query;
    const typedResultId = createModelResultId(resultId);

    // Validate mode
    const breaksMode: BreaksMode = mode === 'static' ? 'static' : 'dynamic';

    // Get results service
    const engine = getFireSTARREngine();
    const resultsService = getModelResultsService(engine);

    // Get result
    const stored = await resultsService.getResultById(typedResultId);
    if (!stored) {
      throw new NotFoundError('Result', resultId);
    }

    const relativeFilePath = stored.result.metadata.filePath as string | undefined;
    if (!relativeFilePath) {
      throw new NotFoundError('Result file', resultId);
    }
    const filePath = resolveResultFilePath(relativeFilePath);
    if (!existsSync(filePath)) {
      throw new NotFoundError('Result file', resultId);
    }

    // Generate contours from GeoTIFF with specified mode
    const contours = await generateContours(filePath, breaksMode);

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
/**
 * @openapi
 * /results/{resultId}/tile/{z}/{x}/{y}.png:
 *   get:
 *     summary: Get raster tile
 *     description: Returns a PNG tile for displaying probability rasters on a slippy map
 *     tags: [Results]
 *     parameters:
 *       - in: path
 *         name: resultId
 *         required: true
 *         schema:
 *           type: string
 *         description: Result ID
 *       - in: path
 *         name: z
 *         required: true
 *         schema:
 *           type: integer
 *         description: Zoom level
 *       - in: path
 *         name: x
 *         required: true
 *         schema:
 *           type: integer
 *         description: Tile X coordinate
 *       - in: path
 *         name: y
 *         required: true
 *         schema:
 *           type: integer
 *         description: Tile Y coordinate
 *     responses:
 *       200:
 *         description: PNG tile image
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/results/:resultId/tile/:z/:x/:y.png',
  asyncHandler(async (req, res) => {
    const { resultId, z, x, y } = req.params;
    const typedResultId = createModelResultId(resultId);

    // Get results service
    const engine = getFireSTARREngine();
    const resultsService = getModelResultsService(engine);

    // Get result
    const stored = await resultsService.getResultById(typedResultId);
    if (!stored) {
      throw new NotFoundError('Result', resultId);
    }

    const relativeFilePath = stored.result.metadata.filePath as string | undefined;
    if (!relativeFilePath) {
      throw new NotFoundError('Result file', resultId);
    }
    const filePath = resolveResultFilePath(relativeFilePath);
    if (!existsSync(filePath)) {
      throw new NotFoundError('Result file', resultId);
    }

    // Generate tile
    const tileBuffer = await generateRasterTile(
      filePath,
      parseInt(z, 10),
      parseInt(x, 10),
      parseInt(y, 10)
    );

    if (!tileBuffer) {
      // Return transparent 256x256 PNG for tiles outside bounds
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      // 1x1 transparent PNG (minimal response for out-of-bounds)
      const transparentPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      res.send(transparentPng);
      return;
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(tileBuffer);
  })
);

/**
 * @openapi
 * /results/{resultId}/bounds:
 *   get:
 *     summary: Get raster bounds
 *     description: Returns the geographic bounds of a raster result in WGS84
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
 *         description: Geographic bounds
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bounds:
 *                   type: array
 *                   items:
 *                     type: number
 *                   description: "[west, south, east, north] in WGS84"
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/results/:resultId/bounds',
  asyncHandler(async (req, res) => {
    const { resultId } = req.params;
    const typedResultId = createModelResultId(resultId);

    // Get results service
    const engine = getFireSTARREngine();
    const resultsService = getModelResultsService(engine);

    // Get result
    const stored = await resultsService.getResultById(typedResultId);
    if (!stored) {
      throw new NotFoundError('Result', resultId);
    }

    const relativeFilePath = stored.result.metadata.filePath as string | undefined;
    if (!relativeFilePath) {
      throw new NotFoundError('Result file', resultId);
    }
    const filePath = resolveResultFilePath(relativeFilePath);
    if (!existsSync(filePath)) {
      throw new NotFoundError('Result file', resultId);
    }

    // Get bounds
    const bounds = await getRasterBounds(filePath);

    res.json({ bounds });
  })
);

router.get(
  '/results/:resultId/download',
  asyncHandler(async (req, res) => {
    const { resultId } = req.params;
    const typedResultId = createModelResultId(resultId);

    // Get results service
    const engine = getFireSTARREngine();
    const resultsService = getModelResultsService(engine);

    // Get result
    const stored = await resultsService.getResultById(typedResultId);
    if (!stored) {
      throw new NotFoundError('Result', resultId);
    }

    const relativeFilePath = stored.result.metadata.filePath as string | undefined;
    if (!relativeFilePath) {
      throw new NotFoundError('Result file', resultId);
    }
    const filePath = resolveResultFilePath(relativeFilePath);
    if (!existsSync(filePath)) {
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
