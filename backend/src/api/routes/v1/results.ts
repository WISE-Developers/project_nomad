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
import { NotFoundError, ValidationError } from '../../../domain/errors/index.js';
import { BoundingBox } from '../../../domain/value-objects/BoundingBox.js';
import { Coordinates } from '../../../domain/value-objects/Coordinates.js';
import { createModelResultId, OutputFormat, OutputType } from '../../../domain/entities/index.js';
import { getModelResultsService } from '../../../application/services/index.js';
import { generateContours, generateRasterTile, getRasterBounds, ContourError } from '../../../infrastructure/firestarr/index.js';
import { getEngine } from '../../../infrastructure/engines/index.js';
import { resolveResultFilePath } from '../../../infrastructure/firestarr/FireSTARRInputGenerator.js';
import { EngineError } from '../../../domain/errors/index.js';
import { EngineType } from '../../../domain/entities/index.js';

const router = Router();

/**
 * WHAT A RESULT ID ACTUALLY IS — one resolver for preview, tile and bounds (#550).
 *
 * These three routes used to open identically: look the row up, read
 * `metadata.filePath`, hand the path to a renderer written for probability rasters.
 * Since #536 persists perimeter and arrival-time rows, that opening was wrong in two
 * different ways at once — a perimeter row 404'd for want of a file it never has, and
 * an arrival grid was rendered with probability symbology, which does not fail, it
 * answers. `download` grew its own branches in #292 and #536; #546 fixed preview
 * inline; this makes the classification one thing all three share, so the next
 * `OutputType` cannot be symbology-matched by accident in two routes out of three.
 *
 * Each route still DECIDES for itself what to do with a product, because the right
 * answer genuinely differs: `bounds` on an arrival raster is correct as it stands —
 * geographic extent does not depend on what the pixel values mean — while `tile` on
 * the same row is not.
 */
type ResolvedProduct =
  | { kind: 'raster'; filePath: string }
  | { kind: 'arrival'; filePath: string | undefined; modelId?: string }
  | { kind: 'perimeter'; geojson: string };

async function resolveResultProduct(
  resultsService: {
    getResultById: (id: ReturnType<typeof createModelResultId>) => Promise<unknown>;
    getPerimeterGeoJSON: (id: ReturnType<typeof createModelResultId>) => Promise<string | undefined>;
    getArrivalRasterPath: (id: ReturnType<typeof createModelResultId>) => Promise<string | undefined>;
  },
  typedResultId: ReturnType<typeof createModelResultId>,
  resultId: string,
): Promise<ResolvedProduct> {
  const stored = (await resultsService.getResultById(typedResultId)) as
    | { modelId?: string; result: { outputType: string; metadata: Record<string, unknown> } }
    | undefined
    | null;

  if (!stored) {
    // Never-persisted synthetic products (#292): the id encodes the product, and the
    // service regenerates it from the arrival rasters still on disk.
    const syntheticPerimeter = await resultsService.getPerimeterGeoJSON(typedResultId);
    if (syntheticPerimeter) return { kind: 'perimeter', geojson: syntheticPerimeter };

    const syntheticArrival = await resultsService.getArrivalRasterPath(typedResultId);
    if (syntheticArrival) return { kind: 'arrival', filePath: syntheticArrival };

    throw new NotFoundError('Result', resultId);
  }

  if (stored.result.outputType === OutputType.Perimeter) {
    // A perimeter row carries its geometry IN the row. The on-demand fallback covers a
    // row written by an older build, or one whose geometry did not survive the
    // repository — the same defence the download route keeps.
    const rowGeoJSON = stored.result.metadata.geojson;
    if (rowGeoJSON !== undefined && rowGeoJSON !== null) {
      return {
        kind: 'perimeter',
        geojson: typeof rowGeoJSON === 'string' ? rowGeoJSON : JSON.stringify(rowGeoJSON),
      };
    }
    const regenerated = await resultsService.getPerimeterGeoJSON(typedResultId);
    if (regenerated) return { kind: 'perimeter', geojson: regenerated };
    throw new NotFoundError('Result file', resultId);
  }

  const relativeFilePath = stored.result.metadata.filePath as string | undefined;

  if (stored.result.outputType === OutputType.ArrivalTime) {
    return {
      kind: 'arrival',
      filePath: relativeFilePath ? resolveResultFilePath(relativeFilePath) : undefined,
      modelId: stored.modelId,
    };
  }

  if (!relativeFilePath) {
    throw new NotFoundError('Result file', resultId);
  }
  const filePath = resolveResultFilePath(relativeFilePath);
  if (!existsSync(filePath)) {
    throw new NotFoundError('Result file', resultId);
  }
  return { kind: 'raster', filePath };
}

/**
 * An arrival-time grid has no probability-symbology rendering (#546, #550).
 *
 * Its values are Julian-day fractions, and neither `generateContours` nor
 * `generateRasterTile` takes a symbology argument, so rendering one through either
 * produces a plausible-looking answer about the wrong quantity. Refusing and naming
 * the endpoint that CAN render it is the honest response.
 */
function arrivalNeedsItsOwnRenderer(resultId: string, modelId?: string): ValidationError {
  const tileEndpoint = modelId
    ? `/api/v1/models/${modelId}/arrival-tile/{z}/{x}/{y}.png`
    : '/api/v1/models/{modelId}/arrival-tile/{z}/{x}/{y}.png';
  return ValidationError.forField(
    'resultId',
    `is an arrival-time grid, whose values are Julian-day fractions rather than ` +
      `probabilities — rendering it with the probability symbology would answer the ` +
      `wrong question rather than fail. Render it with ${tileEndpoint}, or fetch the ` +
      `raster itself from /api/v1/results/${resultId}/download.`,
  );
}

/** A perimeter is a vector product: there is no raster of it to tile (#550). */
function perimeterHasNoRaster(resultId: string): ValidationError {
  return ValidationError.forField(
    'resultId',
    `is a fire perimeter, which is vector geometry and has no raster tiles. Fetch it ` +
      `as GeoJSON from /api/v1/results/${resultId}/preview or ` +
      `/api/v1/results/${resultId}/download.`,
  );
}

/**
 * Bounding box of a perimeter product, in the `[west, south, east, north]` order the
 * bounds route already returns for rasters.
 *
 * EVERY position is walked, not `coordinates[0]`. Reading the first element of a
 * MultiPolygon is how a real two-lobed perimeter got measured as "1 vertex" during
 * #536, and here it would silently return the bbox of one lobe.
 */
function perimeterBounds(geojson: string): [number, number, number, number] {
  const parsed = JSON.parse(geojson) as unknown;
  const positions: Coordinates[] = [];

  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) {
      if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        if (Array.isArray(obj.features)) obj.features.forEach(walk);
        if (obj.geometry) walk(obj.geometry);
        if (obj.coordinates) walk(obj.coordinates);
      }
      return;
    }
    // A position is [lon, lat, ...]; anything else is a nest of positions.
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      positions.push(new Coordinates(node[1] as number, node[0] as number));
      return;
    }
    node.forEach(walk);
  };

  walk(parsed);

  if (positions.length === 0) {
    throw ValidationError.forField('resultId', 'resolved to a perimeter with no coordinates');
  }
  return BoundingBox.fromCoordinates(positions).toGeoJSON();
}

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
    const engine = getEngine(EngineType.FireSTARR);
    const resultsService = getModelResultsService(engine);

    // Get result
    // #546/#550: classify the product BEFORE reaching for a file. A perimeter is
    // served as the GeoJSON it already is; an arrival grid is refused, because
    // contouring Julian days with the probability SLD answers the wrong question
    // rather than failing.
    const product = await resolveResultProduct(resultsService, typedResultId, resultId);

    if (product.kind === 'perimeter') {
      res.setHeader('Content-Type', 'application/geo+json');
      res.send(product.geojson);
      return;
    }

    if (product.kind === 'arrival') {
      throw arrivalNeedsItsOwnRenderer(resultId, product.modelId);
    }

    // Generate contours from GeoTIFF (standardized FireSTARR SLD symbology)
    let contours;
    try {
      contours = await generateContours(product.filePath);
    } catch (err) {
      if (err instanceof ContourError) {
        throw EngineError.outputFailed(
          EngineType.FireSTARR,
          `Contour generation failed: ${err.message}`
        );
      }
      throw err;
    }

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
    const engine = getEngine(EngineType.FireSTARR);
    const resultsService = getModelResultsService(engine);

    // #550: same classification as preview. Neither non-probability product has a
    // probability-symbology tiling: an arrival grid would be coloured as if its
    // Julian days were probabilities, and a perimeter has no raster at all.
    const product = await resolveResultProduct(resultsService, typedResultId, resultId);

    if (product.kind === 'arrival') {
      throw arrivalNeedsItsOwnRenderer(resultId, product.modelId);
    }
    if (product.kind === 'perimeter') {
      throw perimeterHasNoRaster(resultId);
    }

    // Generate tile
    let tileBuffer;
    try {
      tileBuffer = await generateRasterTile(
        product.filePath,
        parseInt(z, 10),
        parseInt(x, 10),
        parseInt(y, 10)
      );
    } catch (err) {
      throw EngineError.outputFailed(
        EngineType.FireSTARR,
        `Tile generation failed for z=${z} x=${x} y=${y}: ${err instanceof Error ? err.message : err}`
      );
    }

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
    const engine = getEngine(EngineType.FireSTARR);
    const resultsService = getModelResultsService(engine);

    // #550: the one place where arrival-time needs NO special case. Geographic extent
    // does not depend on what the pixel values mean, so an arrival raster reads its
    // bounds exactly like a probability raster — this route was never wrong about it,
    // and a test asserts that so it is not "fixed" for symmetry. A perimeter is the
    // route's real gap: its bbox is computable from geometry that is already in hand,
    // and it used to 404.
    const product = await resolveResultProduct(resultsService, typedResultId, resultId);

    if (product.kind === 'perimeter') {
      res.json({ bounds: perimeterBounds(product.geojson) });
      return;
    }

    if (product.kind === 'arrival' && (!product.filePath || !existsSync(product.filePath))) {
      throw new NotFoundError('Result file', resultId);
    }

    // Get bounds
    let bounds;
    try {
      bounds = await getRasterBounds(product.filePath as string);
    } catch (err) {
      throw EngineError.outputFailed(
        EngineType.FireSTARR,
        `Failed to read raster bounds: ${err instanceof Error ? err.message : err}`
      );
    }

    res.json({ bounds });
  })
);

router.get(
  '/results/:resultId/download',
  asyncHandler(async (req, res) => {
    const { resultId } = req.params;
    const typedResultId = createModelResultId(resultId);

    // Get results service
    const engine = getEngine(EngineType.FireSTARR);
    const resultsService = getModelResultsService(engine);

    // Get result
    const stored = await resultsService.getResultById(typedResultId);
    if (!stored) {
      // Deterministic perimeters are synthetic outputs that are never persisted
      // as result rows (#292); regenerate the GeoJSON on demand and stream it.
      const perimeterGeoJSON = await resultsService.getPerimeterGeoJSON(typedResultId);
      if (perimeterGeoJSON) {
        res.setHeader('Content-Type', 'application/geo+json');
        res.setHeader('Content-Disposition', `attachment; filename="${resultId}.geojson"`);
        res.send(perimeterGeoJSON);
        return;
      }
      // Arrival-time raster: another synthetic output (#292). Stream the GeoTIFF.
      const arrivalPath = await resultsService.getArrivalRasterPath(typedResultId);
      if (arrivalPath) {
        if (!existsSync(arrivalPath)) {
          throw new NotFoundError('Result file', resultId);
        }
        const arrivalStats = await stat(arrivalPath);
        res.setHeader('Content-Type', 'image/tiff');
        res.setHeader('Content-Length', arrivalStats.size);
        res.setHeader('Content-Disposition', `attachment; filename="${basename(arrivalPath)}"`);
        createReadStream(arrivalPath).pipe(res);
        return;
      }
      throw new NotFoundError('Result', resultId);
    }

    // #536: a perimeter row carries its geometry IN the row and has no file, so
    // the stored-row branch must not assume a filePath. Before #536 these
    // products were never persisted and this branch was unreachable for them;
    // persisting them so MCP can retrieve them made it reachable, and brought
    // #292 back as a 404 for every model whose rows had been written.
    const rowGeoJSON = stored.result.metadata.geojson;
    if (rowGeoJSON !== undefined && rowGeoJSON !== null) {
      res.setHeader('Content-Type', 'application/geo+json');
      res.setHeader('Content-Disposition', `attachment; filename="${resultId}.geojson"`);
      res.send(typeof rowGeoJSON === 'string' ? rowGeoJSON : JSON.stringify(rowGeoJSON));
      return;
    }

    const relativeFilePath = stored.result.metadata.filePath as string | undefined;
    if (!relativeFilePath) {
      // A row with neither geometry nor a file: derive it, the same way the
      // never-persisted case above does. A row written by an older build, or one
      // whose geometry did not survive the repository, must not 404 while the
      // arrival rasters that produced it are still on disk.
      const regenerated = await resultsService.getPerimeterGeoJSON(typedResultId);
      if (regenerated) {
        res.setHeader('Content-Type', 'application/geo+json');
        res.setHeader('Content-Disposition', `attachment; filename="${resultId}.geojson"`);
        res.send(regenerated);
        return;
      }
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
