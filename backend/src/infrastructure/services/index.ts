/**
 * Infrastructure Services
 *
 * Implementations of application interfaces and other infrastructure concerns.
 */

// Job Queue
export { JobQueue, getJobQueue, resetJobQueue } from './JobQueue.js';

// Model Execution Service
export {
  ModelExecutionService,
  getModelExecutionService,
  resetModelExecutionService,
} from './ModelExecutionService.js';

// Docker Executor
export {
  DockerExecutor,
  getDockerExecutor,
  resetDockerExecutor,
} from '../docker/index.js';

// FireSTARR Engine
export {
  FireSTARREngine,
  getFireSTARREngine,
  resetFireSTARREngine,
  FireSTARRInputGenerator,
  createFireSTARRInputGenerator,
  FireSTARROutputParser,
  getFireSTARROutputParser,
  writeWeatherCSV,
  validateWeatherData,
  rasterizePerimeter,
  isGDALAvailable,
} from '../firestarr/index.js';

// Re-export types
export type {
  WeatherHourlyData,
  FireSTARRParams,
  FireSTARRCommand,
  FireSTARRInputConfig,
  WeatherCSVOptions,
  RasterizeOptions,
  RasterizeResult,
} from '../firestarr/index.js';
