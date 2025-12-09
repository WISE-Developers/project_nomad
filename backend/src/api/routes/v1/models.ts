import { Router } from 'express';
import * as fs from 'fs';
import { asyncHandler } from '../../middleware/index.js';
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
import { getModelRepository } from '../../../infrastructure/database/index.js';
import type { ExecutionOptions } from '../../../application/interfaces/IFireModelingEngine.js';
import type { WeatherConfig } from '../../../infrastructure/weather/types.js';

const router = Router();

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

    // Create model with queued status (skip draft)
    const modelId = createFireModelId(crypto.randomUUID());
    const model = new FireModel({
      id: modelId,
      name: body.name,
      engineType: body.engineType,
      status: ModelStatus.Queued,
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
    console.log(`[ModelsRoute] Creating ignition geometry: type=${body.ignition.type} -> ${geometryType}`);
    const ignitionGeometry = new SpatialGeometry({
      type: geometryType,
      coordinates: body.ignition.coordinates,
    });
    console.log(`[ModelsRoute] Ignition geometry created: ${ignitionGeometry.type}, coords length: ${Array.isArray(body.ignition.coordinates[0]) ? body.ignition.coordinates.length : 1}`);
    const timeRange = new TimeRange(
      new Date(body.timeRange.start),
      new Date(body.timeRange.end)
    );
    const executionOptions: ExecutionOptions = {
      ignitionGeometry,
      timeRange,
      weatherConfig: body.weather,
      simulationCount: body.scenarios ?? 100,
    };

    // Start execution (FireSTARR)
    if (model.engineType === EngineType.FireSTARR) {
      const engine = getFireSTARREngine();

      (async () => {
        try {
          await engine.initialize(model, executionOptions);
          await engine.execute(modelId);
          const status = await engine.getStatus(modelId);
          if (status.state === 'completed') {
            await jobQueue.complete(jobId);
            await modelRepo.save(model.withStatus(ModelStatus.Completed));
          } else if (status.state === 'failed') {
            await jobQueue.fail(jobId, status.error ?? 'Execution failed');
            await modelRepo.save(model.withStatus(ModelStatus.Failed));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[ModelsRoute] Execution failed for model ${modelId}:`, message);
          await jobQueue.fail(jobId, message);
          await modelRepo.save(model.withStatus(ModelStatus.Failed));
        }
      })();
    } else {
      const executionService = getModelExecutionService();
      executionService.execute(model).catch((error) => {
        console.error(`[ModelsRoute] Legacy execution failed:`, error);
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
    console.log(`[ModelsRoute /fire/run] Creating ignition geometry: type=${body.ignition.type} -> ${geometryType}`);
    const ignitionGeometry = new SpatialGeometry({
      type: geometryType,
      coordinates: body.ignition.coordinates,
    });
    console.log(`[ModelsRoute /fire/run] Ignition geometry created: ${ignitionGeometry.type}, coords length: ${Array.isArray(body.ignition.coordinates[0]) ? body.ignition.coordinates.length : 1}`);

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
          console.log(`[ModelsRoute] Initializing FireSTARR engine for model ${id}`);
          await engine.initialize(queuedModel, executionOptions);

          // Mark job as running (sets startedAt timestamp)
          await jobQueue.updateStatus(jobId, JobStatus.Running);

          console.log(`[ModelsRoute] Starting FireSTARR execution for model ${id}`);
          await engine.execute(id as FireModelId);

          // Check execution status
          const status = await engine.getStatus(id as FireModelId);
          if (status.state === 'completed') {
            await jobQueue.complete(jobId);
            // Update model status
            await modelRepo.save(queuedModel.withStatus(ModelStatus.Completed));
          } else if (status.state === 'failed') {
            await jobQueue.fail(jobId, status.error ?? 'Execution failed');
            await modelRepo.save(queuedModel.withStatus(ModelStatus.Failed));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[ModelsRoute] Execution failed for model ${id}:`, message);
          await jobQueue.fail(jobId, message);
          await modelRepo.save(queuedModel.withStatus(ModelStatus.Failed));
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
    console.log(`[ModelsRoute:results] Getting results for model ${id}`);

    const modelRepo = getModelRepository();
    const model = await modelRepo.findById(createFireModelId(id));
    if (!model) {
      throw new NotFoundError('Model', id);
    }

    // Try to get results service - engine may not be configured
    try {
      console.log(`[ModelsRoute:results] Getting engine and service`);
      const engine = getFireSTARREngine();
      const resultsService = getModelResultsService(engine);

      // Get results
      console.log(`[ModelsRoute:results] Calling getResults`);
      const result = await resultsService.getResults(
        id as FireModelId,
        model.name,
        model.engineType
      );

      console.log(`[ModelsRoute:results] Got result, success=${result.success}`);
      if (!result.success) {
        console.log(`[ModelsRoute:results] Result failed, throwing error`);
        throw result.error;
      }

      console.log(`[ModelsRoute:results] Returning result.value with status=${result.value.executionSummary.status}`);
      res.json(result.value);
    } catch (error) {
      // Engine not configured - return empty results
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ModelsRoute:results] Caught error: ${message}`);

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
    const modelRepo = getModelRepository();
    const result = await modelRepo.find({});
    const models = result.models.map((model) => ({
      id: model.id,
      name: model.name,
      engineType: model.engineType,
      status: model.status,
      createdAt: model.createdAt.toISOString(),
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
