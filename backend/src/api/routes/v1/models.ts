import { Router } from 'express';
import * as fs from 'fs';
import { asyncHandler, simpleAuthMiddleware } from '../../middleware/index.js';
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
import { getFireSTARREngine } from '../../../infrastructure/firestarr/index.js';
import { getModelResultsService } from '../../../application/services/index.js';
import { getJobQueue } from '../../../infrastructure/services/JobQueue.js';
import { getModelRepository, getResultRepository } from '../../../infrastructure/database/index.js';
import type { ExecutionOptions, ModelMode } from '../../../application/interfaces/IFireModelingEngine.js';
import type { WeatherConfig } from '../../../infrastructure/weather/types.js';

const VALID_MODEL_MODES: ModelMode[] = ['probabilistic', 'deterministic', 'long-term-risk'];

const router = Router();

// Apply simple auth middleware to all routes
router.use(simpleAuthMiddleware);

/**
 * Combined request body for creating and running a model
 */
interface RunModelRequestBody {
  name: string;
  engineType: EngineType;
  ignition: {
    type: 'point' | 'polygon';
    coordinates: [number, number] | [number, number][];
  };
  timeRange: {
    start: string;
    end: string;
  };
  weather: WeatherConfig;
  scenarios?: number;
  outputMode?: 'probabilistic' | 'pseudo-deterministic';
  modelMode?: ModelMode;
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

    // Validate and resolve modelMode (default: probabilistic)
    const modelMode: ModelMode = body.modelMode ?? 'probabilistic';
    if (!VALID_MODEL_MODES.includes(modelMode)) {
      throw new ValidationError('Invalid model mode', [
        { field: 'modelMode', message: `Must be one of: ${VALID_MODEL_MODES.join(', ')}` },
      ]);
    }

    // Derive outputMode from modelMode before availability gate
    const derivedOutputMode: 'probabilistic' | 'pseudo-deterministic' =
      modelMode === 'deterministic' ? 'pseudo-deterministic' : 'probabilistic';

    if (modelMode !== 'probabilistic') {
      throw new ValidationError('Model mode not available', [
        { field: 'modelMode', message: `'${modelMode}' mode is coming soon and cannot be selected` },
      ]);
    }

    // Create model with queued status (skip draft)
    const modelId = createFireModelId(crypto.randomUUID());
    const model = new FireModel({
      id: modelId,
      name: body.name,
      engineType: body.engineType,
      status: ModelStatus.Queued,
      userId: req.user,  // Capture user ownership
    });

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
    const geometryType = body.ignition.type === 'point' ? GeometryType.Point : GeometryType.Polygon;
    logger.model(`Creating ignition geometry: type=${body.ignition.type} -> ${geometryType}`, modelId);
    const ignitionGeometry = new SpatialGeometry({
      type: geometryType,
      coordinates: body.ignition.coordinates,
    });
    logger.model(`Ignition geometry created: ${ignitionGeometry.type}, coords length: ${Array.isArray(body.ignition.coordinates[0]) ? body.ignition.coordinates.length : 1}`, modelId);
    const timeRange = new TimeRange(
      new Date(body.timeRange.start),
      new Date(body.timeRange.end)
    );
    const executionOptions: ExecutionOptions = {
      ignitionGeometry,
      timeRange,
      weatherConfig: body.weather,
      simulationCount: body.scenarios ?? 100,
      outputMode: derivedOutputMode,
      confidenceInterval: 1,
      smoothPerimeter: false,
    };

    // Start execution (FireSTARR)
    if (model.engineType === EngineType.FireSTARR) {
      const engine = getFireSTARREngine();

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
    const model = new FireModel({
      id,
      name,
      engineType,
      status: ModelStatus.Draft,
      userId: req.user,  // Capture user ownership
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
    });
  })
);

/**
 * Request body for model execution
 */
interface ExecuteRequestBody {
  ignition: {
    type: 'point' | 'polygon';
    coordinates: [number, number] | [number, number][];
  };
  timeRange: {
    start: string;
    end: string;
  };
  weather: WeatherConfig;
  scenarios?: number;
  outputMode?: 'probabilistic' | 'pseudo-deterministic';
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
 *                     enum: [point, polygon]
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

    // Create ignition geometry
    const geometryType = body.ignition.type === 'point' ? GeometryType.Point : GeometryType.Polygon;
    logger.model(`Creating ignition geometry: type=${body.ignition.type} -> ${geometryType}`, id);
    const ignitionGeometry = new SpatialGeometry({
      type: geometryType,
      coordinates: body.ignition.coordinates,
    });
    logger.model(`Ignition geometry created: ${ignitionGeometry.type}, coords length: ${Array.isArray(body.ignition.coordinates[0]) ? body.ignition.coordinates.length : 1}`, id);

    // Create time range
    const timeRange = new TimeRange(
      new Date(body.timeRange.start),
      new Date(body.timeRange.end)
    );

    // Build execution options
    const executionOptions: ExecutionOptions = {
      ignitionGeometry,
      timeRange,
      weatherConfig: body.weather,
      simulationCount: body.scenarios ?? 100,
      outputMode: body.outputMode === 'pseudo-deterministic' ? 'pseudo-deterministic' : 'probabilistic',
      confidenceInterval: 1,
      smoothPerimeter: false,
    };

    // Update model status to queued
    const queuedModel = model.withStatus(ModelStatus.Queued);
    await modelRepo.save(queuedModel);

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
      const engine = getFireSTARREngine();

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
      const engine = getFireSTARREngine();
      const resultsService = getModelResultsService(engine);

      // Get results
      logger.debug(`Calling getResults`, 'Results');
      const result = await resultsService.getResults(
        id as FireModelId,
        model.name,
        model.engineType,
        model.userId
      );

      logger.debug(`Got result, success=${result.success}`, 'Results');
      if (!result.success) {
        logger.debug(`Result failed, throwing error`, 'Results');
        throw result.error;
      }

      logger.debug(`Returning result.value with status=${result.value.executionSummary.status}`, 'Results');
      res.json(result.value);
    } catch (error) {
      // Engine not configured - return empty results
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Error getting results: ${message}`, 'Results');

      res.json({
        modelId: id,
        modelName: model.name,
        engineType: model.engineType,
        executionSummary: {
          startedAt: null,
          completedAt: null,
          durationSeconds: null,
          status: 'failed',  // Changed to 'failed' since an error occurred
          progress: 0,
          error: message,
        },
        outputs: [],
      });
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
    const engine = getFireSTARREngine();
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
    const engine = getFireSTARREngine();
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

    // Get working directory (cast to concrete type for FireSTARR-specific method)
    const engine = getFireSTARREngine();
    const workingDir = (engine as import('../../../infrastructure/firestarr/FireSTARREngine.js').FireSTARREngine).getWorkingDirectory(id as FireModelId);
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
    const engine = getFireSTARREngine();
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
    // Filter by user when simple auth is enabled
    const filter = req.user ? { userId: req.user } : {};
    const result = await modelRepo.find(filter);

    // Get FireSTARR engine for working directory lookup
    const engine = getFireSTARREngine();

    const models = await Promise.all(result.models.map(async (model) => {
      const baseInfo = {
        id: model.id,
        name: model.name,
        engineType: model.engineType,
        status: model.status,
        createdAt: model.createdAt.toISOString(),
        userId: model.userId ?? null,
        outputMode: null as string | null,
        confidenceInterval: null as number | null,
        durationDays: null as number | null,
      };

      // Try to read output config for completed models
      if (model.status === ModelStatus.Completed) {
        try {
          const workingDir = (engine as import('../../../infrastructure/firestarr/FireSTARREngine.js').FireSTARREngine).getWorkingDirectory(model.id);
          if (workingDir) {
            // Read output config
            const configPath = `${workingDir}/output-config.json`;
            if (fs.existsSync(configPath)) {
              const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
              baseInfo.outputMode = config.outputMode || 'probabilistic';
              if (config.outputMode === 'pseudo-deterministic') {
                baseInfo.confidenceInterval = config.confidenceInterval || null;
              }
            }

            // Count probability rasters to get duration in days
            const files = fs.readdirSync(workingDir);
            const probFiles = files.filter(f => f.match(/^probability_\d+(?:_[\d-]+)?\.tif$/));
            baseInfo.durationDays = probFiles.length;
          }
        } catch (e) {
          // Ignore errors reading config - just return null values
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

    // Check ownership when simple auth is enabled
    if (req.user && model.userId && model.userId !== req.user) {
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
      const engine = getFireSTARREngine();
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

export default router;
