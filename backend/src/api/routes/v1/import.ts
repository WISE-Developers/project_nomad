/**
 * Import Route
 *
 * POST /import — accepts a Nomad export ZIP, creates a runnable model
 * with full configuration (ignition, weather, time range) so it can
 * be re-executed on the target instance.
 *
 * ZIP must contain model.json with the full model config.
 * Falls back to metadata.txt if model.json is absent (results-only import).
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { asyncHandler } from '../../middleware/index.js';
import { ValidationError } from '../../../domain/errors/index.js';
import { assertArchiveEntriesSafe } from '../../../application/services/archiveEntryGuard.js';
import {
  FireModel,
  createFireModelId,
  EngineType,
  ModelStatus,
} from '../../../domain/entities/FireModel.js';
import {
  ModelResult,
  createModelResultId,
  OutputType,
  OutputFormat,
} from '../../../domain/entities/ModelResult.js';
import { getModelRepository, getResultRepository } from '../../../infrastructure/database/index.js';
import { pickImportResponseConfig } from './importResponseConfig.js';

const router = Router();

// Accept ZIP uploads up to 500MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed' || extname(file.originalname).toLowerCase() === '.zip') {
      cb(null, true);
    } else {
      cb(new ValidationError('Only ZIP files are accepted'));
    }
  },
});

/**
 * Parse metadata.txt from the export ZIP.
 * Returns key fields: modelName, modelId (source), engine, outputMode, user.
 */
export function parseMetadata(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*(.+?):\s+(.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
      result[key] = match[2].trim();
    }
  }
  return result;
}

/**
 * Map a filename to an OutputType based on known FireSTARR naming conventions.
 */
/**
 * Map a filename to an OutputType for user-facing results only.
 * Recognizes both probabilistic outputs (probability rasters) and
 * deterministic outputs (arrival time grids, extracted perimeters).
 * Internal sim files (intensity_H/M/L, raz, ros, source, dem, fuel,
 * aspect) are NOT imported as results — they're available via the
 * export manifest but don't clutter the results view.
 */
export function filenameToOutputType(filename: string): OutputType | null {
  // Probability rasters: probability_170_2023-06-19.tif
  if (filename.startsWith('probability_')) return OutputType.Probability;
  // Interim probability: interim_probability_001.tif
  if (filename.startsWith('interim_probability_')) return OutputType.Probability;
  // Fire perimeter GeoJSON: fire_perimeter_*.geojson
  if (filename.startsWith('fire_perimeter')) return OutputType.Perimeter;
  // Arrival time grids (deterministic): 000_000001_170_arrival.tif
  if (/^\d{3}_\d{6}_\d+_arrival\.tif$/.test(filename)) return OutputType.ArrivalTime;
  return null;
}

/**
 * Determine output format from file extension.
 */
function extToFormat(filename: string): OutputFormat {
  const ext = extname(filename).toLowerCase();
  if (ext === '.tif' || ext === '.tiff') return OutputFormat.GeoTIFF;
  if (ext === '.geojson' || ext === '.json') return OutputFormat.GeoJSON;
  if (ext === '.kml') return OutputFormat.KML;
  if (ext === '.shp') return OutputFormat.Shapefile;
  return OutputFormat.GeoTIFF;
}

/**
 * Model configuration stored in model.json inside the export ZIP.
 * Contains everything needed to re-run the model.
 */
interface ExportedModelConfig {
  name: string;
  engineType: string;
  modelMode: string;
  ignition: {
    type: 'point' | 'polygon' | 'linestring';
    coordinates: unknown;
  };
  timeRange: {
    start: string;
    end: string;
  };
  weather: Record<string, unknown>;
  scenarios?: number;
  notes?: string;
  sourceModelId?: string;
  exportedAt?: string;
}

router.post(
  '/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError('No file uploaded');
    }

    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();

    // Judge every entry name BEFORE anything is written and before the model row is saved
    // (#517). Placed here rather than inside the extraction loop on purpose: `modelRepo.save`
    // happens before that loop, so validating later would leave a model row behind for an
    // archive that was refused. Decided entirely from declared headers, so nothing is
    // inflated to reach the decision.
    // The sims root is enough to judge containment: the import writes the FINAL segment of
    // each name, which cannot itself contain a separator, so the per-model subdirectory does
    // not change the answer. Resolved here so the check runs before the model row exists.
    const dataPath = process.env.FIRESTARR_DATASET_PATH || process.env.NOMAD_DATA_DIR || './firestarr_data';
    assertArchiveEntriesSafe(entries, join(dataPath, 'sims'));

    // Look for model.json first (full config), fall back to metadata.txt
    const modelJsonEntry = entries.find(e => e.entryName.endsWith('model.json'));
    const metadataEntry = entries.find(e => e.entryName.endsWith('metadata.txt'));

    if (!modelJsonEntry && !metadataEntry) {
      throw new ValidationError('Invalid export ZIP: must contain model.json or metadata.txt');
    }

    let modelName: string;
    let engineType: EngineType;
    let outputMode: string;
    let userId: string;
    let modelStatus: ModelStatus;
    let modelConfig: ExportedModelConfig | null = null;

    if (modelJsonEntry) {
      // Full config import — model can be re-run
      modelConfig = JSON.parse(modelJsonEntry.getData().toString('utf-8'));
      modelName = modelConfig!.name;
      engineType = modelConfig!.engineType === 'wise' ? EngineType.WISE : EngineType.FireSTARR;
      outputMode = modelConfig!.modelMode === 'deterministic' ? 'deterministic' : 'probabilistic';
      userId = String(req.user || 'import');
      modelStatus = ModelStatus.Completed; // Completed with results — config available for re-run
    } else {
      // Legacy results-only import from metadata.txt
      const metadata = parseMetadata(metadataEntry!.getData().toString('utf-8'));
      modelName = metadata['model_name'] || 'Imported Model';
      const engineStr = metadata['engine'] || 'firestarr';
      engineType = engineStr.toLowerCase().includes('firestarr') ? EngineType.FireSTARR : EngineType.FireSTARR;
      outputMode = metadata['output_mode'] || 'probabilistic';
      userId = metadata['user'] || String(req.user || 'import');
      modelStatus = ModelStatus.Completed; // Results only — nothing to re-run
    }

    // Create model with fresh ID
    const newModelId = createFireModelId(randomUUID());
    const model = new FireModel({
      id: newModelId,
      name: `${modelName} (imported)`,
      engineType,
      status: modelStatus,
      userId,
      outputMode,
      notes: modelConfig?.notes,
    });

    const modelRepo = getModelRepository();
    await modelRepo.save(model);

    // Create sim directory and extract files
    const simDir = join(dataPath, 'sims', String(newModelId));
    mkdirSync(simDir, { recursive: true });

    const importedFiles: string[] = [];
    const resultRecords: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const parts = entry.entryName.split('/');
      const filename = parts[parts.length - 1];
      if (!filename) continue;

      // Write all files to sim directory (including model.json for reference)
      const destPath = join(simDir, filename);
      writeFileSync(destPath, entry.getData());
      importedFiles.push(filename);

      // Create result records for recognized output files
      if (filename !== 'metadata.txt' && filename !== 'model.json') {
        const outputType = filenameToOutputType(filename);
        if (outputType) {
          const format = extToFormat(filename);
          const resultId = createModelResultId(randomUUID());
          const relativePath = `${String(newModelId)}/${filename}`;

          const result = new ModelResult({
            id: resultId,
            fireModelId: newModelId,
            outputType,
            format,
            metadata: { filePath: relativePath },
          });

          const resultRepo = getResultRepository();
          await resultRepo.save(result);
          resultRecords.push(filename);
        }
      }
    }

    res.status(201).json({
      modelId: String(newModelId),
      name: model.name,
      status: model.status,
      hasConfig: !!modelConfig,
      config: modelConfig ? pickImportResponseConfig(modelConfig as unknown as Record<string, unknown>) : null,
      imported: {
        files: importedFiles.length,
        results: resultRecords.length,
        fileList: importedFiles,
        resultList: resultRecords,
      },
    });
  })
);

export default router;
