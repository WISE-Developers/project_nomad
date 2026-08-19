import { Router } from 'express';
import * as fs from 'fs';
import { asyncHandler, resolveUserId, resolveUserIdCandidates } from '../../middleware/index.js';
import { logger } from '../../../infrastructure/logging/index.js';
import {
  FireModel,
  createFireModelId,
  EngineType,
  ModelStatus,
  GeometryType,
  SpatialGeometry,
  JobStatus,
  type FireModelId,
} from '../../../domain/entities/index.js';
import { TimeRange } from '../../../domain/value-objects/index.js';
import { NotFoundError, ValidationError } from '../../../domain/errors/index.js';
import { getModelExecutionService } from '../../../infrastructure/services/index.js';
import {
  generateArrivalTile,
  findArrivalTifs,
  getRasterBounds,
} from '../../../infrastructure/firestarr/index.js';
import { getEngine, getWorkspaceAwareEngine } from '../../../infrastructure/engines/index.js';
import { EngineError } from '../../../domain/errors/index.js';
import { getModelResultsService } from '../../../application/services/index.js';
import { getJobQueue } from '../../../infrastructure/services/JobQueue.js';
import { getModelRepository, getResultRepository } from '../../../infrastructure/database/index.js';
import type { ExecutionOptions, ModelMode } from '../../../application/interfaces/IFireModelingEngine.js';
import type { WeatherConfig } from '../../../infrastructure/weather/types.js';
import { parseIsoToDate } from '../../../shared/dateParsing.js';
import { assertWeatherMeetsEngineContract } from '../../../application/services/WeatherContractCheck.js';

const VALID_MODEL_MODES: ModelMode[] = ['probabilistic', 'deterministic', 'long-term-risk'];

const router = Router();


/**
 * Combined request body for creating and running a model
 */
interface RunModelRequestBody {
  name: string;
  engineType: EngineType;
  ignition: {
    type: 'point' | 'polygon' | 'linestring';
    coordinates: [number, number] | [number, number][];
  };
  timeRange: {
    start: string;
    end: string;
  };
  /** IANA timezone identifier (e.g. "America/Edmonton"). Required — no fallback. */
  timezone: string;
  weather: WeatherConfig;
  scenarios?: number;
  outputMode?: 'probabilistic' | 'deterministic';
  modelMode?: ModelMode;
  notes?: string;
}

/**
 * @openapi
 * /models/run:
 *   post:
 *     summary: Create and run a model
 *     description: Creates a new model and immediately starts execution (atomic operation)
 *     tags: [Models]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - engineType
 *               - ignition
 *               - timeRange
 *               - weather
 *             properties:
 *               name:
 *                 type: string
 *               engineType:
 *                 type: string
 *                 enum: [firestarr, wise]
 *               ignition:
 *                 type: object
 *               timeRange:
 *                 type: object
 *               weather:
 *                 type: object
 *               scenarios:
 *                 type: number
 *     responses:
 *       202:
 *         description: Model created and execution started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 modelId:
 *                   type: string
 *                 jobId:
 *                   type: string
 *                 message:
 *                   type: string
 */
router.post(
  '/models/run',
  asyncHandler(async (req, res) => {
    const body = req.body as RunModelRequestBody;

    // Validate input
    if (!body.name || typeof body.name !== 'string') {
      throw ValidationError.required('name');
    }
    if (!body.engineType || !Object.values(EngineType).includes(body.engineType)) {
      throw ValidationError.invalidEnum('engineType', Object.values(EngineType), body.engineType);
    }
    if (!body.ignition?.type || !body.ignition?.coordinates) {
      throw new ValidationError('Ignition geometry required', [
        { field: 'ignition', message: 'Must provide ignition type and coordinates' },
      ]);
    }
    if (!body.timeRange?.start || !body.timeRange?.end) {
      throw new ValidationError('Time range required', [
        { field: 'timeRange', message: 'Must provide start and end dates' },
      ]);
    }
    if (!body.weather?.source) {
      throw new ValidationError('Weather configuration required', [
        { field: 'weather', message: 'Must provide weather source' },
      ]);
    }
    if (typeof body.timezone !== 'string' || body.timezone.length === 0) {
      throw new ValidationError('Timezone required', [
        { field: 'timezone', message: 'Must provide IANA timezone identifier (e.g. "America/Edmonton") — no runtime fallback' },
      ]);
    }

    // Validate and resolve modelMode (default: probabilistic)
    const modelMode: ModelMode = body.modelMode ?? 'probabilistic';
    if (!VALID_MODEL_MODES.includes(modelMode)) {
      throw new ValidationError('Invalid model mode', [
        { field: 'modelMode', message: `Must be one of: ${VALID_MODEL_MODES.join(', ')}` },
      ]);
    }

    // Derive outputMode from modelMode before availability gate
    const derivedOutputMode: 'probabilistic' | 'deterministic' =
      modelMode === 'deterministic' ? 'deterministic' : 'probabilistic';

    if (modelMode !== 'probabilistic' && modelMode !== 'deterministic') {
      throw new ValidationError('Model mode not available', [
        { field: 'modelMode', message: `'${modelMode}' mode is coming soon and cannot be selected` },
      ]);
    }

    // Validate geometry and time range BEFORE creating DB records (prevents orphaned rows)
    const geometryType = body.ignition.type === 'point'
      ? GeometryType.Point
      : body.ignition.type === 'linestring'
        ? GeometryType.LineString
        : GeometryType.Polygon;
    const ignitionGeometry = new SpatialGeometry({
      type: geometryType,
      coordinates: body.ignition.coordinates,
    });
    const timeRange = new TimeRange(
      parseIsoToDate(body.timeRange.start, 'POST /models body.timeRange.start'),
      parseIsoToDate(body.timeRange.end, 'POST /models body.timeRange.end'),
    );

    // Check the weather against FireSTARR's input contract BEFORE anything is
    // created (#339, #340, #341). FireSTARR builds its daily fire weather from
    // each day's noon record; a day without one throws FATAL: map::at about ten
    // seconds in, with the reason only in the container log. Four of six runs
    // on the CIFFC demo died that way on 2026-08-19. Failing here means a 400
    // naming the problem while the user can still fix it, and no orphaned model,
    // job or sim directory to clean up.
    const ignitionLatitude = Array.isArray(body.ignition.coordinates[0])
      ? (body.ignition.coordinates as [number, number][])[0][1]
      : (body.ignition.coordinates as [number, number])[1];
    const ignitionLongitude = Array.isArray(body.ignition.coordinates[0])
      ? (body.ignition.coordinates as [number, number][])[0][0]
      : (body.ignition.coordinates as [number, number])[0];

    await assertWeatherMeetsEngineContract(
      body.weather,
      timeRange.start,
      body.timezone,
      { latitude: ignitionLatitude, longitude: ignitionLongitude },
      { start: timeRange.start, end: timeRange.end },
    );

    // Create model with queued status (skip draft)
    const modelId = createFireModelId(crypto.randomUUID());
    const model = new FireModel({
      id: modelId,
      name: body.name,
      engineType: body.engineType,
      status: ModelStatus.Queued,
      userId: resolveUserId(req),
      notes: body.notes,
      outputMode: derivedOutputMode,
    });

    logger.model(`Creating ignition geometry: type=${body.ignition.type} -> ${geometryType}`, modelId);
    logger.model(`Ignition geometry created: ${ignitionGeometry.type}, coords length: ${Array.isArray(body.ignition.coordinates[0]) ? body.ignition.coordinates.length : 1}`, modelId);

    const modelRepo = getModelRepository();
    await modelRepo.save(model);

    // Create job
    const jobQueue = getJobQueue();
    const jobResult = await jobQueue.enqueue(modelId);
    if (!jobResult.success) {
      // Clean up model on failure
      await modelRepo.delete(modelId);
      throw new ValidationError('Failed to create job', [
        { field: 'job', message: jobResult.error.message },
      ]);
    }
    const jobId = jobResult.value.id;

    // Build execution options
    const executionOptions: ExecutionOptions = {
      ignitionGeometry,
      timeRange,
      timezone: body.timezone,
      weatherConfig: body.weather,
      simulationCount: body.scenarios ?? 100,
      outputMode: derivedOutputMode,
      confidenceInterval: 1,
      smoothPerimeter: false,
    };

    // Start execution (FireSTARR)
    if (model.engineType === EngineType.FireSTARR) {
      const engine = getEngine(EngineType.FireSTARR);

      (async () => {
        try {
          // Mark job as running (sets startedAt timestamp)
          await jobQueue.updateStatus(jobId, JobStatus.Running);

          await engine.initialize(model, executionOptions);
          await engine.execute(modelId);
          const status = await engine.getStatus(modelId);
          if (status.state === 'completed') {
            await jobQueue.complete(jobId);
            await modelRepo.save(model.withStatus(ModelStatus.Completed));
            // Harvest results immediately after completion
            try {
              const results = await engine.getResults(modelId);
              const resultRepo = getResultRepository();
              for (const result of results) {
                await resultRepo.save(result);
              }
              logger.model(`Harvested ${results.length} results`, modelId);
            } catch (harvestError) {
              logger.warn(`Failed to harvest results for model ${modelId}: ${harvestError}`, 'Model');
              // Continue anyway - results can still be lazy-loaded on first read
            }
          } else if (status.state === 'failed') {
            await jobQueue.fail(jobId, status.error ?? 'Execution failed');
            await modelRepo.save(model.withStatus(ModelStatus.Failed));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`Execution failed: ${message}`, 'Model', { modelId });
          await jobQueue.fail(jobId, message);
          await modelRepo.save(model.withStatus(ModelStatus.Failed));
        }
      })();
    } else {
      const executionService = getModelExecutionService();
      executionService.execute(model).catch((error) => {
        logger.error(`Legacy execution failed: ${error}`, 'Model');
      });
    }

    res.status(202).json({
      modelId,
      jobId,
      message: 'Model created and execution started',
    });
  })
);

/**
 * @openapi
 * /models:
 *   post:
 *     summary: Create a new model
 *     description: Creates a new fire model in draft status
 *     tags: [Models]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - engineType
 *             properties:
 *               name:
 *                 type: string
 *                 description: User-provided name for the model
 *               engineType:
 *                 type: string
 *                 enum: [firestarr, wise]
 *                 description: Fire modeling engine to use
 *     responses:
 *       201:
 *         description: Model created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *                 engineType:
 *                   type: string
 *                 status:
 *                   type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 */
router.post(
  '/models',
  asyncHandler(async (req, res) => {
    const { name, engineType } = req.body;

    // Validate input
    if (!name || typeof name !== 'string') {
      throw ValidationError.required('name');
    }

    if (!engineType || !Object.values(EngineType).includes(engineType)) {
      throw ValidationError.invalidEnum('engineType', Object.values(EngineType), engineType);
    }

    // Create model
    const id = createFireModelId(crypto.randomUUID());
    const { notes } = req.body;
    const model = new FireModel({
      id,
      name,
      engineType,
      status: ModelStatus.Draft,
      userId: resolveUserId(req),
      notes: typeof notes === 'string' ? notes : undefined,
    });

    // Persist to database
    const modelRepo = getModelRepository();
    await modelRepo.save(model);

    res.status(201).json({
      id: model.id,
      name: model.name,
      engineType: model.engineType,
      status: model.status,
      createdAt: model.createdAt.toISOString(),
      userId: model.userId ?? null,
      notes: model.notes ?? null,
    });
  })
);

/**
 * @openapi
 * /models/{id}:
 *   get:
 *     summary: Get a model by ID
 *     description: Returns model details and execution status
 *     tags: [Models]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Model ID
 *     responses:
 *       200:
 *         description: Model details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 name:
 *                   type: string
 *                 engineType:
 *                   type: string
 *                   enum: [firestarr, wise]
 *                 status:
 *                   type: string
 *                   enum: [draft, queued, running, completed, failed]
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/models/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const modelRepo = getModelRepository();
    const model = await modelRepo.findById(createFireModelId(id));
    if (!model) {
      throw new NotFoundError('Model', id);
    }

    res.json({
      id: model.id,
      name: model.name,
      engineType: model.engineType,
      status: model.status,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
      userId: model.userId ?? null,
      notes: model.notes ?? null,
      outputMode: model.outputMode ?? null,
    });
  })
);

/**
 * Request body for model execution
 */
interface ExecuteRequestBody {
  ignition: {
    type: 'point' | 'polygon' | 'linestring';
    coordinates: [number, number] | [number, number][];
  };
  timeRange: {
    start: string;
    end: string;
  };
  /** IANA timezone identifier (e.g. "America/Edmonton"). Required — no fallback. */
  timezone: string;
  weather: WeatherConfig;
  scenarios?: number;
  outputMode?: 'probabilistic' | 'deterministic';
}

/**
 * @openapi
 * /models/{id}/execute:
 *   post:
 *     summary: Execute a model
 *     description: Starts asynchronous execution of a fire model with provided parameters. Returns a job ID for status tracking.
 *     tags: [Models]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Model ID to execute
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ignition
 *               - timeRange
 *               - weather
 *             properties:
 *               ignition:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [point, polygon, linestring]
 *                   coordinates:
 *                     oneOf:
 *                       - type: array
 *                         items:
 *                           type: number
 *                         minItems: 2
 *                         maxItems: 2
 *                       - type: array
 *                         items:
 *                           type: array
 *                           items:
 *                             type: number
 *               timeRange:
 *                 type: object
 *                 properties:
 *                   start:
 *                     type: string
 *                     format: date-time
 *                   end:
 *                     type: string
 *                     format: date-time
 *               weather:
 *                 type: object
 *                 properties:
 *                   source:
 *                     type: string
 *                     enum: [manual, spotwx]
 *                   manual:
 *                     type: object
 *                     properties:
 *                       ffmc:
 *                         type: number
 *                       dmc:
 *                         type: number
 *                       dc:
 *                         type: number
 *                       windSpeed:
 *                         type: number
 *                       windDirection:
 *                         type: number
 *                       temperature:
 *                         type: number
 *                       humidity:
 *                         type: number
 *               scenarios:
 *                 type: number
 *                 description: Number of scenarios for probabilistic modeling
 *     responses:
 *       202:
 *         description: Execution started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobId:
 *                   type: string
 *                   format: uuid
 *                   description: Job ID for tracking execution status
 *                 message:
 *                   type: string
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       400:
 *         description: Model cannot be executed (invalid status or missing data)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post(
  '/models/:id/execute',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = req.body as ExecuteRequestBody;

    // Get model
    const modelRepo = getModelRepository();
    const model = await modelRepo.findById(createFireModelId(id));
    if (!model) {
      throw new NotFoundError('Model', id);
    }

    // Validate model can execute
    if (!model.canExecute()) {
      throw new ValidationError('Model cannot be executed', [
        { field: 'status', message: `Model status is ${model.status}, must be draft or failed` },
      ]);
    }

    // Validate request body
    if (!body.ignition?.type || !body.ignition?.coordinates) {
      throw new ValidationError('Ignition geometry required', [
        { field: 'ignition', message: 'Must provide ignition type and coordinates' },
      ]);
    }

    if (!body.timeRange?.start || !body.timeRange?.end) {
      throw new ValidationError('Time range required', [
        { field: 'timeRange', message: 'Must provide start and end dates' },
      ]);
    }

    if (!body.weather?.source) {
      throw new ValidationError('Weather configuration required', [
        { field: 'weather', message: 'Must provide weather source (manual or spotwx)' },
      ]);
    }
    if (typeof body.timezone !== 'string' || body.timezone.length === 0) {
      throw new ValidationError('Timezone required', [
        { field: 'timezone', message: 'Must provide IANA timezone identifier (e.g. "America/Edmonton") — no runtime fallback' },
      ]);
    }

    // Create ignition geometry
    const geometryType = body.ignition.type === 'point'
      ? GeometryType.Point
      : body.ignition.type === 'linestring'
        ? GeometryType.LineString
        : GeometryType.Polygon;
    logger.model(`Creating ignition geometry: type=${body.ignition.type} -> ${geometryType}`, id);
    const ignitionGeometry = new SpatialGeometry({
      type: geometryType,
      coordinates: body.ignition.coordinates,
    });
    logger.model(`Ignition geometry created: ${ignitionGeometry.type}, coords length: ${Array.isArray(body.ignition.coordinates[0]) ? body.ignition.coordinates.length : 1}`, id);

    // Create time range
    const timeRange = new TimeRange(
      parseIsoToDate(body.timeRange.start, 'POST /models/:id/execute body.timeRange.start'),
      parseIsoToDate(body.timeRange.end, 'POST /models/:id/execute body.timeRange.end'),
    );

    // Build execution options
    const executionOptions: ExecutionOptions = {
      ignitionGeometry,
      timeRange,
      timezone: body.timezone,
      weatherConfig: body.weather,
      simulationCount: body.scenarios ?? 100,
      outputMode: body.outputMode === 'deterministic' ? 'deterministic' : 'probabilistic',
      confidenceInterval: 1,
      smoothPerimeter: false,
    };

    // Update model with execution metadata and queue it
    const updatedModel = new FireModel({
      id: model.id,
      name: model.name,
      engineType: model.engineType,
      status: ModelStatus.Queued,
      createdAt: model.createdAt,
      updatedAt: new Date(),
      userId: model.userId ?? resolveUserId(req),
      notes: model.notes,
      outputMode: body.outputMode === 'deterministic' ? 'deterministic' : 'probabilistic',
    });
    await modelRepo.save(updatedModel);
    const queuedModel = updatedModel;

    // Create job in queue
    const jobQueue = getJobQueue();
    const jobResult = await jobQueue.enqueue(id as FireModelId);
    if (!jobResult.success) {
      await modelRepo.save(model); // Revert to previous status
      throw new ValidationError('Failed to create job', [
        { field: 'job', message: jobResult.error.message },
      ]);
    }

    const jobId = jobResult.value.id;

    // Start execution with FireSTARREngine (for FireSTARR models)
    if (model.engineType === EngineType.FireSTARR) {
      const engine = getEngine(EngineType.FireSTARR);

      // Initialize and execute asynchronously
      (async () => {
        try {
          logger.engine(`Initializing FireSTARR engine`, 'FireSTARR', id);
          await engine.initialize(queuedModel, executionOptions);

          // Mark job as running (sets startedAt timestamp)
          await jobQueue.updateStatus(jobId, JobStatus.Running);

          logger.engine(`Starting execution`, 'FireSTARR', id);
          await engine.execute(id as FireModelId);

          // Check execution status
          const status = await engine.getStatus(id as FireModelId);
          if (status.state === 'completed') {
            await jobQueue.complete(jobId);
            // Update model status
            await modelRepo.save(queuedModel.withStatus(ModelStatus.Completed));
            // Harvest results immediately after completion
            try {
              const results = await engine.getResults(id as FireModelId);
              const resultRepo = getResultRepository();
              for (const result of results) {
                await resultRepo.save(result);
              }
              logger.model(`Harvested ${results.length} results`, id);
            } catch (harvestError) {
              logger.warn(`Failed to harvest results for model ${id}: ${harvestError}`, 'Model');
              // Continue anyway - results can still be lazy-loaded on first read
            }
          } else if (status.state === 'failed') {
            await jobQueue.fail(jobId, status.error ?? 'Execution failed');
            await modelRepo.save(queuedModel.withStatus(ModelStatus.Failed));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(`Execution failed: ${message}`, 'Model', { modelId: id });
          await jobQueue.fail(jobId, message);
          await modelRepo.save(queuedModel.withStatus(ModelStatus.Failed));
        }
      })();
    } else {
      // For other engine types, use the legacy execution service
      const executionService = getModelExecutionService();
      executionService.execute(queuedModel).catch((error) => {
        logger.error(`Legacy execution failed: ${error}`, 'Model');
      });
    }

    res.status(202).json({
      jobId,
      message: 'Model execution started',
    });
  })
);

/**
 * @openapi
 * /models/{id}/results:
 *   get:
 *     summary: Get model results
 *     description: Returns execution results and output files for a completed model
 *     tags: [Models]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Model ID
 *     responses:
 *       200:
 *         description: Model results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 modelId:
 *                   type: string
 *                 modelName:
 *                   type: string
 *                 engineType:
 *                   type: string
 *                 executionSummary:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                     progress:
 *                       type: number
 *                     startedAt:
 *                       type: string
 *                     completedAt:
 *                       type: string
 *                     durationSeconds:
 *                       type: number
 *                 outputs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       type:
 *                         type: string
 *                       format:
 *                         type: string
 *                       name:
 *                         type: string
 *                       previewUrl:
 *                         type: string
 *                       downloadUrl:
 *                         type: string
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/models/:id/results',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    logger.debug(`Getting results for model ${id}`, 'Results');

    const modelRepo = getModelRepository();
    const model = await modelRepo.findById(createFireModelId(id));
    if (!model) {
      throw new NotFoundError('Model', id);
    }

    // Try to get results service - engine may not be configured
    try {
      logger.debug(`Getting engine and service`, 'Results');
      const engine = getEngine(EngineType.FireSTARR);
      const resultsService = getModelResultsService(engine);

      // Get results
      logger.debug(`Calling getResults`, 'Results');
      const result = await resultsService.getResults(
        id as FireModelId,
        model.name,
        model.engineType,
        model.userId,
        model.notes
      );

      logger.debug(`Got result, success=${result.success}`, 'Results');
      if (!result.success) {
        logger.debug(`Result failed, throwing error`, 'Results');
        throw result.error;
      }

      // If engine returned no outputs but model is completed (e.g. imported),
      // fall back to database results
      if (result.value.outputs.length === 0 && model.status === ModelStatus.Completed) {
        logger.debug(`Engine returned no outputs for completed model — falling back to DB results`, 'Results');
        throw new Error('Falling back to DB results for imported/completed model');
      }

      logger.debug(`Returning result.value with status=${result.value.executionSummary.status}`, 'Results');
      res.json(result.value);
    } catch (error) {
      // Engine not configured or no execution state — fall back to database results
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`Falling back to DB results: ${message}`, 'Results');

      const resultRepo = getResultRepository();
      const dbResults = await resultRepo.findByModelId(createFireModelId(id));

      if (dbResults.length > 0 && model.status === ModelStatus.Completed) {
        // Build response from database results (imported or completed models)
        res.json({
          modelId: id,
          modelName: model.name,
          engineType: model.engineType,
          userId: model.userId,
          notes: model.notes,
          executionSummary: {
            startedAt: model.createdAt.toISOString(),
            completedAt: model.updatedAt?.toISOString() ?? model.createdAt.toISOString(),
            durationSeconds: null,
            status: 'completed',
            progress: 100,
          },
          outputs: dbResults.map(r => ({
            id: r.id,
            type: r.outputType,
            format: r.format,
            name: r.getDisplayName(),
            filePath: (r.metadata.filePath as string) ?? null,
            previewUrl: `/api/v1/results/${r.id}/preview`,
            downloadUrl: `/api/v1/results/${r.id}/download`,
            metadata: r.metadata,
          })),
        });
      } else {
        res.json({
          modelId: id,
          modelName: model.name,
          engineType: model.engineType,
          executionSummary: {
            startedAt: null,
            completedAt: null,
            durationSeconds: null,
            status: model.status === ModelStatus.Completed ? 'completed' : 'failed',
            progress: 0,
            error: model.status === ModelStatus.Completed ? undefined : message,
          },
          outputs: [],
        });
      }
    }
  })
);

/**
 * @openapi
 * /models/{id}/inputs/weather:
 *   get:
 *     summary: Download model weather input
 *     description: Returns the weather CSV file used as input for the model
 *     tags: [Models]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Model ID
 *     responses:
 *       200:
 *         description: Weather CSV file
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/models/:id/inputs/weather',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const modelRepo = getModelRepository();
    const model = await modelRepo.findById(createFireModelId(id));
    if (!model) {
      throw new NotFoundError('Model', id);
    }

    // Get results to find the simulation directory
    const engine = getEngine(EngineType.FireSTARR);
    const resultsService = getModelResultsService(engine);
    const result = await resultsService.getResults(
      id as FireModelId,
      model.name,
      model.engineType
    );

    if (!result.success || !result.value.inputs?.weatherCsvPath) {
      throw new NotFoundError('Weather data', id);
    }

    const weatherPath = result.value.inputs.weatherCsvPath;
    if (!fs.existsSync(weatherPath)) {
      throw new NotFoundError('Weather file', weatherPath);
    }

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="weather_${id}.csv"`);

    // Stream the file
    const readStream = fs.createReadStream(weatherPath);
    readStream.pipe(res);
  })
);

/**
 * @openapi
 * /models/{id}/inputs/ignition:
 *   get:
 *     summary: Download model ignition geometry
 *     description: Returns the ignition GeoJSON used as input for the model
 *     tags: [Models]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Model ID
 *     responses:
 *       200:
 *         description: Ignition GeoJSON
 *         content:
 *           application/geo+json:
 *             schema:
 *               type: object
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/models/:id/inputs/ignition',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const modelRepo = getModelRepository();
    const model = await modelRepo.findById(createFireModelId(id));
    if (!model) {
      throw new NotFoundError('Model', id);
    }

    // Get results to find the ignition geometry
    const engine = getEngine(EngineType.FireSTARR);
    const resultsService = getModelResultsService(engine);
    const result = await resultsService.getResults(
      id as FireModelId,
      model.name,
      model.engineType
    );

    if (!result.success || !result.value.inputs?.ignition?.geojson) {
      throw new NotFoundError('Ignition geometry', id);
    }

    // Set headers for GeoJSON download
    res.setHeader('Content-Type', 'application/geo+json');
    res.setHeader('Content-Disposition', `attachment; filename="ignition_${id}.geojson"`);

    res.json(result.value.inputs.ignition.geojson);
  })
);

/**
 * @openapi
 * /models/{id}/perimeters:
 *   get:
 *     summary: Get perimeter GeoJSON for a specific day
 *     description: Returns the generated perimeter polygon for a given day using the model's configured confidence interval
 *     tags: [Models]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Model ID
 *       - in: query
 *         name: day
 *         required: true
 *         schema:
 *           type: number
 *         description: Day number (e.g., 170 for day of year)
 *     responses:
 *       200:
 *         description: Perimeter GeoJSON
 *         content:
 *           application/geo+json:
 *             schema:
 *               type: object
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
  '/models/:id/perimeters',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const day = parseInt(req.query.day as string, 10);

    if (isNaN(day)) {
      throw new ValidationError('Day parameter required', [
        { field: 'day', message: 'Must provide a valid day number as query parameter' },
      ]);
    }

    const modelRepo = getModelRepository();
    const model = await modelRepo.findById(createFireModelId(id));
    if (!model) {
      throw new NotFoundError('Model', id);
    }

    // Check model is completed
    if (model.status !== ModelStatus.Completed) {
      throw new ValidationError('Model must be completed to get perimeters', [
        { field: 'status', message: `Model status is ${model.status}` },
      ]);
    }

    // Get working directory via the workspace-aware engine capability
    const engine = getWorkspaceAwareEngine(EngineType.FireSTARR);
    const workingDir = engine.getWorkingDirectory(id as FireModelId);
    if (!workingDir || !fs.existsSync(workingDir)) {
      throw new NotFoundError('Working directory', id);
    }

    // Read output-config.json to get confidence settings
    const configPath = `${workingDir}/output-config.json`;
    let confidenceInterval = 1; // default
    let smoothPerimeter = false; // default

    if (fs.existsSync(configPath)) {
      try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        if (config.confidenceInterval && config.confidenceInterval >= 1 && config.confidenceInterval <= 90) {
          confidenceInterval = config.confidenceInterval;
        }
        if (typeof config.smoothPerimeter === 'boolean') {
          smoothPerimeter = config.smoothPerimeter;
        }
      } catch (e) {
        logger.warn(`Failed to read output-config.json: ${e}`, 'Perimeters');
      }
    }

    // Find the probability raster for the requested day
    const probabilityFile = fs.readdirSync(workingDir)
      .find(f => f.match(new RegExp(`^probability_${day}(?:_[\\d-]+)?\\.tif$`)));

    if (!probabilityFile) {
      throw new NotFoundError('Probability raster', `day ${day}`, 'No matching probability raster found');
    }

    const filePath = `${workingDir}/${probabilityFile}`;

    // Generate the perimeter
    const { generatePerimeterForFile } = await import('../../../infrastructure/firestarr/index.js');
    const result = await generatePerimeterForFile(filePath, {
      confidenceInterval,
      smoothPerimeter,
      simplifyTolerance: 0.0001,
    });

    if (!result.success) {
      throw result.error;
    }

    // Set headers for GeoJSON
    res.setHeader('Content-Type', 'application/geo+json');
    res.json(result.value.geojson);
  })
);

/**
 * @openapi
 * /models/{id}/perimeters:
 *   post:
 *     summary: Generate vector perimeters from probability rasters
 *     description: Converts probability raster outputs to vector polygons using GDAL
 *     tags: [Models]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Model ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - confidenceInterval
 *             properties:
 *               confidenceInterval:
 *                 type: number
 *                 description: Confidence interval (1-90), represents threshold (e.g., 50 = pixels >= 0.5)
 *                 minimum: 1
 *                 maximum: 90
 *               smoothPerimeter:
 *                 type: boolean
 *                 description: Whether to simplify the polygon
 *                 default: false
 *               simplifyTolerance:
 *                 type: number
 *                 description: Simplification tolerance in degrees (default 0.0001 ~= 10m)
 *                 default: 0.0001
 *     responses:
 *       200:
 *         description: Generated perimeters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 perimeters:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       day:
 *                         type: number
 *                       geojson:
 *                         type: object
 *                       confidenceInterval:
 *                         type: number
 *                 totalRasters:
 *                   type: number
 *                 successCount:
 *                   type: number
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post(
  '/models/:id/perimeters',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { confidenceInterval, smoothPerimeter = false, simplifyTolerance = 0.0001 } = req.body;

    // Validate confidence interval
    if (typeof confidenceInterval !== 'number' || confidenceInterval < 1 || confidenceInterval > 90) {
      throw new ValidationError('Invalid confidence interval', [
        { field: 'confidenceInterval', message: 'Must be a number between 1 and 90' },
      ]);
    }

    const modelRepo = getModelRepository();
    const model = await modelRepo.findById(createFireModelId(id));
    if (!model) {
      throw new NotFoundError('Model', id);
    }

    // Check model is completed
    if (model.status !== ModelStatus.Completed) {
      throw new ValidationError('Model must be completed to generate perimeters', [
        { field: 'status', message: `Model status is ${model.status}` },
      ]);
    }

    // Get the working directory from results
    const engine = getEngine(EngineType.FireSTARR);
    const resultsService = getModelResultsService(engine);
    const resultResponse = await resultsService.getResults(
      id as FireModelId,
      model.name,
      model.engineType,
      model.userId
    );

    if (!resultResponse.success || resultResponse.value.outputs.length === 0) {
      throw new NotFoundError('Model results', id, 'No probability rasters found');
    }

    // Get working directory from first output file
    const firstOutput = resultResponse.value.outputs[0];
    if (!firstOutput.filePath) {
      throw new NotFoundError('Output files', id, 'No file path found in results');
    }

    // Import perimeter generator
    const { generatePerimeters } = await import('../../../infrastructure/firestarr/index.js');
    const { resolveResultFilePath } = await import('../../../infrastructure/firestarr/FireSTARRInputGenerator.js');

    // Resolve absolute path and get working directory
    const absolutePath = resolveResultFilePath(firstOutput.filePath);
    const workingDir = absolutePath.substring(0, absolutePath.lastIndexOf('/'));

    // Generate perimeters
    const perimeterResult = await generatePerimeters(workingDir, {
      confidenceInterval,
      smoothPerimeter,
      simplifyTolerance,
    });

    if (!perimeterResult.success) {
      throw perimeterResult.error;
    }

    res.json(perimeterResult.value);
  })
);

/**
 * @openapi
 * /models:
 *   get:
 *     summary: List models
 *     description: Returns all models
 *     tags: [Models]
 *     responses:
 *       200:
 *         description: List of models
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 models:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       engineType:
 *                         type: string
 *                       status:
 *                         type: string
 *                 total:
 *                   type: number
 */
router.get(
  '/models',
  asyncHandler(async (req, res) => {
    const modelRepo = getModelRepository();
    // Dual-match during the #346 transition: newer models are keyed by email,
    // older ones by display name. Matching both keeps a user's earlier work
    // visible without a data migration.
    const userIds = resolveUserIdCandidates(req);
    const filter = userIds.length > 0 ? { userId: userIds } : {};
    const result = await modelRepo.find(filter);

    // Get the workspace-aware engine for working directory lookup
    const engine = getWorkspaceAwareEngine(EngineType.FireSTARR);

    const models = await Promise.all(result.models.map(async (model) => {
      const baseInfo = {
        id: model.id,
        name: model.name,
        engineType: model.engineType,
        status: model.status,
        createdAt: model.createdAt.toISOString(),
        userId: model.userId ?? null,
        notes: model.notes ?? null,
        outputMode: model.outputMode ?? null,
        confidenceInterval: null as number | null,
        durationDays: null as number | null,
      };

      // Try to read duration from filesystem for completed models
      if (model.status === ModelStatus.Completed) {
        try {
          const workingDir = engine.getWorkingDirectory(model.id);
          if (workingDir) {
            // Count probability rasters to get duration in days
            const files = fs.readdirSync(workingDir);
            const probFiles = files.filter(f => f.match(/^probability_\d+(?:_[\d-]+)?\.tif$/));
            baseInfo.durationDays = probFiles.length;
          }
        } catch (e) {
          // Ignore errors reading filesystem - just return null for durationDays
        }
      }

      return baseInfo;
    }));

    res.json({
      models,
      total: result.totalCount,
    });
  })
);

/**
 * @openapi
 * /models/{id}:
 *   delete:
 *     summary: Delete a model
 *     description: Deletes a model and all its associated results
 *     tags: [Models]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Model ID to delete
 *     responses:
 *       200:
 *         description: Model deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 deletedResults:
 *                   type: number
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.delete(
  '/models/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const modelRepo = getModelRepository();
    const model = await modelRepo.findById(createFireModelId(id));
    if (!model) {
      throw new NotFoundError('Model', id);
    }

    // Dual-match as above: a user must still be able to delete a model they
    // created before ownership moved from display name to email (#346).
    const userIds = resolveUserIdCandidates(req);
    if (userIds.length > 0 && model.userId && !userIds.includes(model.userId)) {
      throw new ValidationError('Permission denied', [
        { field: 'userId', message: 'You can only delete your own models' },
      ]);
    }

    // Delete associated data first (order matters due to foreign keys)
    const { getResultRepository, getJobRepository } = await import('../../../infrastructure/database/index.js');

    // 1. Delete results (references model)
    const resultRepo = getResultRepository();
    const deletedResults = await resultRepo.deleteByModelId(createFireModelId(id));

    // 2. Delete jobs (references model)
    const jobRepo = getJobRepository();
    const deletedJobs = await jobRepo.deleteByModelId(createFireModelId(id));

    // 3. Delete the model
    await modelRepo.delete(createFireModelId(id));

    // Clean up engine state if present
    try {
      const engine = getEngine(EngineType.FireSTARR);
      await engine.cleanup(id as FireModelId, false);
    } catch {
      // Engine may not have this model - that's fine
    }

    res.json({
      message: `Model ${id} deleted`,
      deletedResults,
      deletedJobs,
    });
  })
);

/**
 * GET /models/:id/config
 *
 * Returns the stored execution config (model.json or output-config.json)
 * for a model. Used by the frontend to re-run imported or completed models.
 */
router.get(
  '/models/:id/config',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const modelRepo = getModelRepository();
    const model = await modelRepo.findById(createFireModelId(id));
    if (!model) throw new NotFoundError('Model', id);

    // Find sim directory from results
    const resultRepo = getResultRepository();
    const results = await resultRepo.findByModelId(createFireModelId(id));

    let simDir: string | null = null;
    for (const result of results) {
      const filePath = (result.metadata.filePath as string) ?? null;
      if (filePath) {
        const { resolveResultFilePath } = await import('../../../infrastructure/firestarr/FireSTARRInputGenerator.js');
        const { dirname } = await import('path');
        const resolved = resolveResultFilePath(filePath);
        simDir = dirname(resolved);
        break;
      }
    }

    if (!simDir) {
      res.json({ hasConfig: false, config: null });
      return;
    }

    const { join } = await import('path');

    // Try model.json first (from import), then output-config.json (from local run)
    for (const configFile of ['model.json', 'output-config.json']) {
      const configPath = join(simDir, configFile);
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

        // Belt-and-suspenders: if config lacks ignition, try to merge from ignition.geojson
        // This handles output-config.json written before the ignition persistence fix (#229)
        if (!config.ignition) {
          const ignitionPath = join(simDir, 'ignition.geojson');
          if (fs.existsSync(ignitionPath)) {
            const ignitionData = JSON.parse(fs.readFileSync(ignitionPath, 'utf-8'));
            let geom = ignitionData;
            if (ignitionData.type === 'FeatureCollection' && ignitionData.features?.length > 0) {
              geom = ignitionData.features[0].geometry;
            } else if (ignitionData.type === 'Feature') {
              geom = ignitionData.geometry;
            }
            if (geom?.coordinates) {
              config.ignition = {
                type: geom.type === 'Point' ? 'point' : geom.type === 'LineString' ? 'linestring' : 'polygon',
                coordinates: geom.coordinates,
              };
              logger.debug(`Merged ignition from ignition.geojson into ${configFile}`, 'Config');
            }
          }
        }

        res.json({ hasConfig: true, source: configFile, config });
        return;
      }
    }

    // Also try to reconstruct minimal config from ignition.geojson
    const ignitionPath = join(simDir, 'ignition.geojson');
    if (fs.existsSync(ignitionPath)) {
      const ignitionData = JSON.parse(fs.readFileSync(ignitionPath, 'utf-8'));
      let geom = ignitionData;
      if (ignitionData.type === 'FeatureCollection' && ignitionData.features?.length > 0) {
        geom = ignitionData.features[0].geometry;
      } else if (ignitionData.type === 'Feature') {
        geom = ignitionData.geometry;
      }

      res.json({
        hasConfig: true,
        source: 'reconstructed',
        config: {
          name: model.name,
          engineType: model.engineType,
          modelMode: model.outputMode || 'probabilistic',
          ignition: geom?.coordinates ? {
            type: geom.type === 'Point' ? 'point' : geom.type === 'LineString' ? 'linestring' : 'polygon',
            coordinates: geom.coordinates,
          } : undefined,
        },
      });
      return;
    }

    res.json({ hasConfig: false, config: null });
  })
);

/**
 * @openapi
 * /models/{id}/arrival-tile/{z}/{x}/{y}.png:
 *   get:
 *     summary: RGB-encoded arrival-time tile
 *     description: |
 *       Returns a Web Mercator PNG tile of the FireSTARR arrival-time raster,
 *       with Julian-day values terrain-RGB encoded for client-side MapLibre
 *       `raster-color` classification. Issue #226.
 */
router.get(
  '/models/:id/arrival-tile/:z/:x/:y.png',
  asyncHandler(async (req, res) => {
    const { id, z, x, y } = req.params;
    const t = (req.query.t as string) ?? 'daily';
    const timestep: 'daily' | 'hourly' = t === 'hourly' ? 'hourly' : 'daily';
    const breaksRaw = parseInt(req.query.breaks as string, 10);
    const breaksPerDay = Number.isFinite(breaksRaw) && breaksRaw > 0 ? breaksRaw : undefined;
    const ramp = typeof req.query.ramp === 'string' ? req.query.ramp : undefined;
    const customStops =
      typeof req.query.stops === 'string' && req.query.stops.length > 0
        ? req.query.stops.split(',')
        : undefined;
    // dayColors=1:ff8800,2:00ff00 → { 1: '#ff8800', 2: '#00ff00' } (#271 Unit 7)
    let dayColorOverrides: Record<number, string> | undefined;
    if (typeof req.query.dayColors === 'string' && req.query.dayColors.length > 0) {
      dayColorOverrides = {};
      for (const pair of req.query.dayColors.split(',')) {
        const [k, v] = pair.split(':');
        const idx = parseInt(k, 10);
        if (Number.isFinite(idx) && v) {
          dayColorOverrides[idx] = v.startsWith('#') ? v : `#${v}`;
        }
      }
    }
    const highlightBuckets =
      typeof req.query.highlight === 'string' && req.query.highlight.length > 0
        ? req.query.highlight
            .split(',')
            .map((s) => parseInt(s, 10))
            .filter((n) => Number.isFinite(n))
        : undefined;
    const modelId = id as FireModelId;

    const engine = getWorkspaceAwareEngine(EngineType.FireSTARR);
    const workingDir = engine.getWorkingDirectory(modelId);
    if (!workingDir || !fs.existsSync(workingDir)) {
      throw new NotFoundError('Working directory', id);
    }

    const info = findArrivalTifs(workingDir);
    if (!info) throw new NotFoundError('Arrival raster', id);

    let tileBuffer;
    try {
      tileBuffer = await generateArrivalTile(
        info.filePath,
        info.offsetDay,
        info.endJulian,
        timestep,
        parseInt(z, 10),
        parseInt(x, 10),
        parseInt(y, 10),
        { breaksPerDay, ramp, customStops, dayColorOverrides, highlightBuckets },
      );
    } catch (err) {
      throw EngineError.outputFailed(
        EngineType.FireSTARR,
        `Arrival tile generation failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (!tileBuffer) {
      // 1x1 transparent PNG for out-of-bounds tiles
      res.send(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ));
      return;
    }
    res.send(tileBuffer);
  }),
);

/**
 * @openapi
 * /models/{id}/arrival-bounds:
 *   get:
 *     summary: Arrival raster metadata
 *     description: |
 *       Returns bounds + offset / start / end Julian days for the model's
 *       arrival-time raster — used by the frontend to configure its
 *       `raster-color` paint and dynamic legend. Issue #226.
 */
router.get(
  '/models/:id/arrival-bounds',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const modelId = id as FireModelId;

    const engine = getWorkspaceAwareEngine(EngineType.FireSTARR);
    const workingDir = engine.getWorkingDirectory(modelId);
    if (!workingDir || !fs.existsSync(workingDir)) {
      throw new NotFoundError('Working directory', id);
    }
    const info = findArrivalTifs(workingDir);
    if (!info) throw new NotFoundError('Arrival raster', id);

    // Derive classification window from model's configured timeRange
    let startJulian = info.offsetDay;
    let endJulian = info.endJulian;
    try {
      const cfgPath = fs.existsSync(`${workingDir}/output-config.json`)
        ? `${workingDir}/output-config.json`
        : `${workingDir}/model.json`;
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (raw.timeRange) {
        const dayOfYear = (d: Date) => {
          const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
          return Math.floor((d.getTime() - jan1.getTime()) / 86_400_000) + 1;
        };
        startJulian = dayOfYear(parseIsoToDate(raw.timeRange.start, 'arrival tile raw.timeRange.start'));
        endJulian = dayOfYear(parseIsoToDate(raw.timeRange.end, 'arrival tile raw.timeRange.end'));
      }
    } catch { /* use file-derived values */ }

    const bounds = await getRasterBounds(info.filePath);
    res.json({
      bounds,
      offsetDay: startJulian,
      startJulian,
      endJulian,
      julianDays: info.julianDays,
    });
  }),
);

/**
 * @openapi
 * /models/{id}/arrival-perimeters:
 *   get:
 *     summary: Hourly perimeter polygons for the animation slider
 *     description: |
 *       Polygonizes the deterministic arrival-time raster into a
 *       FeatureCollection of incremental per-hour perimeters. Each feature
 *       carries `offsetHours` (1-based hour from sim start) and `isoTime`
 *       (wall-clock UTC) so the frontend slider can render the fire growing
 *       through time. Capped at 168 frames (7 days). Issue #236.
 */
router.get(
  '/models/:id/arrival-perimeters',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const modelId = id as FireModelId;

    const engine = getWorkspaceAwareEngine(EngineType.FireSTARR);
    const workingDir = engine.getWorkingDirectory(modelId);
    if (!workingDir || !fs.existsSync(workingDir)) {
      throw new NotFoundError('Working directory', id);
    }

    const info = findArrivalTifs(workingDir);
    if (!info) throw new NotFoundError('Arrival raster', id);

    const cfgPath = fs.existsSync(`${workingDir}/output-config.json`)
      ? `${workingDir}/output-config.json`
      : `${workingDir}/model.json`;
    const rawCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));

    const { extractArrivalAnimation, extractSimTimeRange, defaultAnimationExtractorDeps } =
      await import('../../../infrastructure/firestarr/arrivalAnimation.js');
    const { simStart, durationHours } = extractSimTimeRange(rawCfg);

    const featureCollection = await extractArrivalAnimation(
      {
        arrivalPath: info.filePath,
        simStart,
        durationHours,
      },
      defaultAnimationExtractorDeps(),
    );

    res.json(featureCollection);
  }),
);

export default router;
