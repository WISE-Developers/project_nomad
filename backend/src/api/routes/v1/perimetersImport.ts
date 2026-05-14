/**
 * Perimeters Import Route (#267)
 *
 * POST /api/v1/perimeters/import — accepts a single perimeter file
 * (GeoJSON or KML) and returns a normalized GeoJSON FeatureCollection
 * ready to feed the ignition flow.
 */

import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../middleware/index.js';
import { ValidationError } from '../../../domain/errors/index.js';
import { detectPerimeterFormat } from '../../../application/perimeters/detectPerimeterFormat.js';
import { parsePerimeterGeoJSON } from '../../../application/perimeters/parsePerimeterGeoJSON.js';
import { parsePerimeterKML } from '../../../application/perimeters/parsePerimeterKML.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post(
  '/perimeters/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw ValidationError.forField('file', 'is required');
    }
    const format = detectPerimeterFormat(req.file.originalname);
    const content = req.file.buffer.toString('utf-8');
    const result =
      format === 'geojson' ? parsePerimeterGeoJSON(content) : parsePerimeterKML(content);
    res.status(201).json(result);
  }),
);

export default router;
