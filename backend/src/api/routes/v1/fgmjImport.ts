/**
 * Prometheus/WISE job import route (#294)
 *
 * POST /api/v1/import/fgmj — accepts a .fgmj job, or a .zip of the job folder,
 * and returns one import plan per scenario.
 *
 * PARSE ONLY. Nothing is persisted. The plans prefill the Model Setup wizard so
 * the operator reviews the blockers and divergences and submits a run
 * themselves — the same path any other model takes. Follows perimetersImport
 * rather than the ZIP model import, which creates records on upload.
 */

import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../middleware/index.js';
import { ValidationError } from '../../../domain/errors/index.js';
import { importFgmjUpload } from '../../../application/prometheus/importFgmjUpload.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  // A job folder carries elevation and fuel rasters alongside the .fgmj, and
  // real archives run large — Dogrib_v624.fgmj alone is 13.5 MB. Below the ZIP
  // model import's 500 MB, which also carries simulation outputs.
  limits: { fileSize: 200 * 1024 * 1024 },
});

router.post(
  '/import/fgmj',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw ValidationError.forField('file', 'is required');
    }
    const scenarios = importFgmjUpload(req.file.buffer, req.file.originalname);
    res.status(201).json({
      fileName: req.file.originalname,
      scenarios,
      // One .fgmj commonly holds several — SS008-25 and FS001-23 each hold
      // three — so the operator picks which one to set up.
      scenarioCount: scenarios.length,
      runnableCount: scenarios.filter((s) => s.runnable).length,
    });
  }),
);

export default router;
