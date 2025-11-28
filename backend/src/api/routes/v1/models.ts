import { Router } from 'express';
import { asyncHandler } from '../../middleware/index.js';
import {
  FireModel,
  createFireModelId,
  EngineType,
  ModelStatus,
  GeometryType,
  SpatialGeometry,
  type FireModelId,
} from '../../../domain/entities/index.js';
import { TimeRange } from '../../../domain/value-objects/index.js';
import { NotFoundError, ValidationError } from '../../../domain/errors/index.js';
import { getModelExecutionService } from '../../../infrastructure/services/index.js';
import { getFireSTARREngine } from '../../../infrastructure/firestarr/index.js';
import { getModelResultsService } from '../../../application/services/index.js';
import { getJobQueue } from '../../../infrastructure/services/JobQueue.js';
import type { ExecutionOptions } from '../../../application/interfaces/IFireModelingEngine.js';
import type { WeatherConfig } from '../../../infrastructure/weather/types.js';

const router = Router();

// Temporary in-memory model storage until IModelRepository is implemented
const tempModels: Map<string, FireModel> = new Map();

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
    });

    // Store temporarily (will be replaced with repository)
    tempModels.set(id, model);

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

    const model = tempModels.get(id);
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
    const model = tempModels.get(id);
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
    const ignitionGeometry = new SpatialGeometry({
      type: geometryType,
      coordinates: body.ignition.coordinates,
    });

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
    };

    // Update model status to queued
    const queuedModel = model.withStatus(ModelStatus.Queued);
    tempModels.set(id, queuedModel);

    // Create job in queue
    const jobQueue = getJobQueue();
    const jobResult = await jobQueue.enqueue(id as FireModelId);
    if (!jobResult.success) {
      tempModels.set(id, model);
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
          console.log(`[ModelsRoute] Initializing FireSTARR engine for model ${id}`);
          await engine.initialize(queuedModel, executionOptions);

          console.log(`[ModelsRoute] Starting FireSTARR execution for model ${id}`);
          await engine.execute(id as FireModelId);

          // Check execution status
          const status = await engine.getStatus(id as FireModelId);
          if (status.state === 'completed') {
            await jobQueue.complete(jobId);
            // Update model status
            tempModels.set(id, queuedModel.withStatus(ModelStatus.Completed));
          } else if (status.state === 'failed') {
            await jobQueue.fail(jobId, status.error ?? 'Execution failed');
            tempModels.set(id, queuedModel.withStatus(ModelStatus.Failed));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[ModelsRoute] Execution failed for model ${id}:`, message);
          await jobQueue.fail(jobId, message);
          tempModels.set(id, queuedModel.withStatus(ModelStatus.Failed));
        }
      })();
    } else {
      // For other engine types, use the legacy execution service
      const executionService = getModelExecutionService();
      executionService.execute(queuedModel).catch((error) => {
        console.error(`[ModelsRoute] Legacy execution failed:`, error);
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

    const model = tempModels.get(id);
    if (!model) {
      throw new NotFoundError('Model', id);
    }

    // Try to get results service - engine may not be configured
    try {
      const engine = getFireSTARREngine();
      const resultsService = getModelResultsService(engine);

      // Get results
      const result = await resultsService.getResults(
        id as FireModelId,
        model.name,
        model.engineType
      );

      if (!result.success) {
        throw result.error;
      }

      res.json(result.value);
    } catch (error) {
      // Engine not configured - return empty results
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ModelsRoute] Engine not available for results: ${message}`);

      res.json({
        modelId: id,
        modelName: model.name,
        engineType: model.engineType,
        executionSummary: {
          startedAt: null,
          completedAt: null,
          durationSeconds: null,
          status: 'queued',
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
  asyncHandler(async (_req, res) => {
    const models = Array.from(tempModels.values()).map((model) => ({
      id: model.id,
      name: model.name,
      engineType: model.engineType,
      status: model.status,
      createdAt: model.createdAt.toISOString(),
    }));

    res.json({
      models,
      total: models.length,
    });
  })
);

export default router;
