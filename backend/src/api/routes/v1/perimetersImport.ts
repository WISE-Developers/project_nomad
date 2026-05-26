/**
 * Perimeters Import Route (#267, #269)
 *
 * POST /api/v1/perimeters/import — accepts a single perimeter file
 * (GeoJSON, KML, or zipped shapefile bundle) and returns a normalized
 * GeoJSON FeatureCollection ready to feed the ignition flow.
 */

import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../middleware/index.js';
import { ValidationError } from '../../../domain/errors/index.js';
import { detectPerimeterFormat } from '../../../application/perimeters/detectPerimeterFormat.js';
import { parsePerimeterGeoJSON } from '../../../application/perimeters/parsePerimeterGeoJSON.js';
import { parsePerimeterKML } from '../../../application/perimeters/parsePerimeterKML.js';
import { parsePerimeterShapefile } from '../../../application/perimeters/parsePerimeterShapefile.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  // Shapefiles + sidecars in a zip can be larger than text formats
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.post(
  '/perimeters/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw ValidationError.forField('file', 'is required');
    }
    const format = detectPerimeterFormat(req.file.originalname);

    let result;
    if (format === 'shapefile') {
      result = await parsePerimeterShapefile(req.file.buffer);
    } else {
      const content = req.file.buffer.toString('utf-8');
      result =
        format === 'geojson' ? parsePerimeterGeoJSON(content) : parsePerimeterKML(content);
    }
    res.status(201).json(result);
  }),
);

export default router;
