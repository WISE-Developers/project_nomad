/**
 * Export Routes
 *
 * API endpoints for creating and downloading export bundles.
 */

import { Router } from 'express';
import { asyncHandler } from '../../middleware/index.js';
import { NotFoundError, ValidationError } from '../../../domain/errors/index.js';
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

export default router;
