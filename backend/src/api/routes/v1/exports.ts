/**
 * Export Routes
 *
 * API endpoints for creating and downloading export bundles.
 */

import { Router } from 'express';
import { asyncHandler } from '../../middleware/index.js';
import { NotFoundError, ValidationError } from '../../../domain/errors/index.js';
import { logger } from '../../../infrastructure/logging/index.js';
import {
  getExportFormatRegistry,
  createBundleBuilder,
  storeBundle,
  getBundle,
  getZipGenerator,
  getShareableLinkService,
} from '../../../infrastructure/export/index.js';

const router = Router();

/**
 * @openapi
 * /exports/formats:
 *   get:
 *     summary: Get available export formats
 *     description: Returns list of supported export formats with metadata
 *     tags: [Exports]
 *     responses:
 *       200:
 *         description: List of export formats
 */
router.get(
  '/exports/formats',
  asyncHandler(async (_req, res) => {
    const registry = getExportFormatRegistry();
    const formats = registry.getFormats();

    res.json({
      formats: formats.map((f) => ({
        id: f.id,
        name: f.name,
        extension: f.extension,
        category: f.category,
        supportedOutputTypes: f.supportedOutputTypes,
      })),
    });
  })
);

/**
 * @openapi
 * /exports:
 *   post:
 *     summary: Create an export bundle
 *     description: Creates a bundle of outputs ready for download
 *     tags: [Exports]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [modelId, items]
 *             properties:
 *               modelId:
 *                 type: string
 *               modelName:
 *                 type: string
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [resultId]
 *                   properties:
 *                     resultId:
 *                       type: string
 *                     format:
 *                       type: string
 *     responses:
 *       201:
 *         description: Export bundle created
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 */
router.post(
  '/exports',
  asyncHandler(async (req, res) => {
    const { modelId, modelName, items } = req.body;

    if (!modelId || !items || !Array.isArray(items) || items.length === 0) {
      throw new ValidationError('modelId and items array are required');
    }

    const builder = createBundleBuilder();
    builder.forModel(modelId, modelName);

    for (const item of items) {
      if (!item.resultId) {
        throw new ValidationError('Each item must have a resultId');
      }
      builder.addItem(item.resultId, item.format);
    }

    const bundle = await builder.build();
    storeBundle(bundle);

    res.status(201).json({
      exportId: bundle.id,
      manifest: bundle.manifest,
    });
  })
);

/**
 * @openapi
 * /exports/{exportId}/download:
 *   get:
 *     summary: Download export as ZIP
 *     description: Downloads the export bundle as a ZIP archive
 *     tags: [Exports]
 *     parameters:
 *       - in: path
 *         name: exportId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: ZIP archive stream
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/exports/:exportId/download',
  asyncHandler(async (req, res) => {
    const { exportId } = req.params;

    const bundle = getBundle(exportId);
    if (!bundle) {
      throw new NotFoundError('Export', exportId);
    }

    const zipGenerator = getZipGenerator();
    const filename = zipGenerator.getFilename(bundle);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await zipGenerator.generateZip(bundle, res);
  })
);

/**
 * @openapi
 * /exports/{exportId}/share:
 *   post:
 *     summary: Create shareable link
 *     description: Creates a shareable link for the export bundle
 *     tags: [Exports]
 *     parameters:
 *       - in: path
 *         name: exportId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expiresInHours:
 *                 type: number
 *                 default: 24
 *               maxDownloads:
 *                 type: number
 *                 default: 10
 *     responses:
 *       201:
 *         description: Shareable link created
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post(
  '/exports/:exportId/share',
  asyncHandler(async (req, res) => {
    const { exportId } = req.params;
    const { expiresInHours, maxDownloads } = req.body;

    const bundle = getBundle(exportId);
    if (!bundle) {
      throw new NotFoundError('Export', exportId);
    }

    const linkService = getShareableLinkService();
    const link = linkService.createLink(exportId, { expiresInHours, maxDownloads });

    res.status(201).json({
      shareUrl: linkService.getShareUrl(link.token),
      token: link.token,
      expiresAt: link.expiresAt.toISOString(),
      maxDownloads: link.maxDownloads,
    });
  })
);

/**
 * @openapi
 * /share/{token}:
 *   get:
 *     summary: Download via shareable link
 *     description: Downloads the export using a shareable link token
 *     tags: [Exports]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: ZIP archive stream
 *       404:
 *         description: Link not found or expired
 *       410:
 *         description: Download limit reached
 */
router.get(
  '/share/:token',
  asyncHandler(async (req, res) => {
    const { token } = req.params;

    const linkService = getShareableLinkService();
    const link = linkService.validateToken(token);

    if (!link) {
      // Check if it exists but is exhausted
      const existingLink = linkService.getLink(token);
      if (existingLink && existingLink.downloadCount >= existingLink.maxDownloads) {
        res.status(410).json({
          error: 'Gone',
          message: 'Download limit reached for this link',
        });
        return;
      }

      throw new NotFoundError('Share link', token);
    }

    const bundle = getBundle(link.exportId);
    if (!bundle) {
      throw new NotFoundError('Export', link.exportId);
    }

    // Record the download
    linkService.recordDownload(token);

    const zipGenerator = getZipGenerator();
    const filename = zipGenerator.getFilename(bundle);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await zipGenerator.generateZip(bundle, res);
  })
);

/**
 * POST /exports/files
 *
 * Export raw files from a model's simulation directory as a ZIP.
 * Accepts filenames (from the export manifest) instead of result IDs.
 */
router.post(
  '/exports/files',
  asyncHandler(async (req, res) => {
    const { modelId, modelName, filenames } = req.body;

    if (!modelId || !filenames || !Array.isArray(filenames) || filenames.length === 0) {
      throw new ValidationError('modelId and filenames array are required');
    }

    // Resolve sim directory from model results
    const { getResultRepository, getModelRepository } = await import('../../../infrastructure/database/index.js');
    const { createFireModelId } = await import('../../../domain/entities/FireModel.js');
    const { resolveResultFilePath } = await import('../../../infrastructure/firestarr/FireSTARRInputGenerator.js');

    const modelRepo = getModelRepository();
    const model = await modelRepo.findById(createFireModelId(modelId));
    if (!model) throw new NotFoundError('Model', modelId);

    const resultRepo = getResultRepository();
    const results = await resultRepo.findByModelId(createFireModelId(modelId));

    let simDir: string | null = null;
    for (const result of results) {
      const filePath = (result.metadata.filePath as string) ?? null;
      if (filePath) {
        const { dirname } = await import('path');
        simDir = dirname(resolveResultFilePath(filePath));
        break;
      }
    }

    if (!simDir) throw new NotFoundError('Simulation directory', modelId);

    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const { streamFilesToZip } = await import('../../../infrastructure/export/streamFilesToZip.js');

    // Validate all requested files exist
    const validFiles: string[] = [];
    for (const filename of filenames) {
      // Security: prevent path traversal
      if (filename.includes('..') || filename.includes('/')) continue;
      const fullPath = join(simDir, filename);
      if (existsSync(fullPath)) {
        validFiles.push(filename);
      }
    }

    if (validFiles.length === 0) {
      throw new ValidationError('No valid files found in simulation directory');
    }

    // Always include log file if it exists
    const logPath = join(simDir, 'firestarr.log');
    if (existsSync(logPath) && !validFiles.includes('firestarr.log')) {
      validFiles.push('firestarr.log');
    }

    // Read output config for mode
    let outputMode = 'probabilistic';
    const configPath = join(simDir, 'output-config.json');
    if (existsSync(configPath)) {
      try {
        const { readFileSync } = await import('fs');
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (config.outputMode) outputMode = config.outputMode;
      } catch { /* use default */ }
    }

    // Get username from model or request
    const username = model.userId || req.user || 'unknown';
    const safeUser = String(username).replace(/[^a-zA-Z0-9-_]/g, '_');
    const safeName = (modelName || modelId).replace(/[^a-zA-Z0-9-_]/g, '_');
    const zipFilename = `${safeName}_${outputMode}_${safeUser}.zip`;

    // Build metadata.txt
    const now = new Date().toISOString();
    const metadata = [
      `Project Nomad — Model Export`,
      `=============================`,
      ``,
      `Model Name:      ${modelName || 'N/A'}`,
      `Model ID:        ${modelId}`,
      `Engine:          ${model.engineType}`,
      `Output Mode:     ${outputMode}`,
      `User:            ${username}`,
      `Status:          ${model.status}`,
      `Created:         ${model.createdAt.toISOString()}`,
      `Exported:        ${now}`,
      ``,
      `Files Included (${validFiles.length}):`,
      ...validFiles.map(f => `  - ${f}`),
      ``,
      `File Categories:`,
      `  Inputs:      Ignition geometry, weather data, terrain/fuel grids`,
      `  Aggregated:  Burn probability, intensity, fire sizes (probabilistic mode)`,
      `  Final:       Arrival time, intensity, rate of spread, source (last simulation day)`,
      `  Log:         FireSTARR execution log`,
      ``,
      `Output Mode Explanation:`,
      outputMode === 'deterministic'
        ? `  Deterministic — Single simulation with no random variation.`
        + `\n  Produces arrival-time grids and fire boundary perimeters.`
        : `  Probabilistic — Multiple simulations with stochastic variation.`
        + `\n  Produces burn probability rasters showing fire spread likelihood.`,
      ``,
      `Generated by Project Nomad (https://github.com/WISE-Developers/project_nomad)`,
    ].join('\n');

    // Build model.json with full config for re-runnable import
    const modelConfig: Record<string, unknown> = {
      name: modelName || model.name,
      engineType: model.engineType,
      modelMode: outputMode,
      sourceModelId: modelId,
      exportedAt: now,
      notes: model.notes || undefined,
    };

    // Read ignition from sim directory if present
    const ignitionPath = join(simDir, 'ignition.geojson');
    if (existsSync(ignitionPath)) {
      try {
        const { readFileSync } = await import('fs');
        const ignitionData = JSON.parse(readFileSync(ignitionPath, 'utf-8'));
        // Extract geometry from Feature or FeatureCollection
        let geom = ignitionData;
        if (ignitionData.type === 'FeatureCollection' && ignitionData.features?.length > 0) {
          geom = ignitionData.features[0].geometry;
        } else if (ignitionData.type === 'Feature') {
          geom = ignitionData.geometry;
        }
        if (geom?.type && geom?.coordinates) {
          modelConfig.ignition = {
            type: geom.type === 'Point' ? 'point' : geom.type === 'LineString' ? 'linestring' : 'polygon',
            coordinates: geom.coordinates,
          };
        }
      } catch { /* ignition reconstruction failed — skip */ }
    }

    // Read output-config.json for execution parameters if present
    if (existsSync(configPath)) {
      try {
        const { readFileSync } = await import('fs');
        const outputConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (outputConfig.timeRange) modelConfig.timeRange = outputConfig.timeRange;
        if (outputConfig.weather) modelConfig.weather = outputConfig.weather;
        if (outputConfig.scenarios) modelConfig.scenarios = outputConfig.scenarios;
        if (outputConfig.notes) modelConfig.notes = outputConfig.notes;
      } catch { /* config reconstruction failed — skip */ }
    }

    const entries: import('../../../infrastructure/export/streamFilesToZip.js').ZipEntry[] = [
      { name: 'metadata.txt', content: metadata },
      { name: 'model.json', content: JSON.stringify(modelConfig, null, 2) },
      ...validFiles.map((filename) => ({ name: filename, path: join(simDir, filename) })),
    ];

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    try {
      await streamFilesToZip(entries, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[exports/files] streaming failure for model ${modelId}: ${message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'EXPORT_FAILED', message });
        return;
      }
      // Headers already on the wire — abort the connection so the browser
      // surfaces a clear failure instead of a truncated ZIP.
      res.destroy(err instanceof Error ? err : new Error(message));
    }
  })
);

export default router;
