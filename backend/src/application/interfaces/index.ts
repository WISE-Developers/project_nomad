/**
 * Application Interfaces
 *
 * Abstractions that enable dependency inversion between the application layer
 * and external systems. Implementations are provided by the infrastructure layer.
 */

// Fire Modeling Engine
export {
  type IFireModelingEngine,
  type ExecutionStatus,
  type ExecutionOptions,
  type EngineCapabilities,
} from './IFireModelingEngine.js';

// Weather Repository
export {
  type IWeatherRepository,
  type WeatherSource,
  type WeatherSourceType,
  type WeatherFetchOptions,
  type WeatherFetchResult,
} from './IWeatherRepository.js';

// Spatial Repository
export {
  type ISpatialRepository,
  type ElevationData,
  type FuelTypeData,
  type SpatialQueryResult,
  type SpatialQueryOptions,
} from './ISpatialRepository.js';

// Model Repository
export {
  type IModelRepository,
  type ModelFilter,
  type SpatialModelFilter,
  type ModelQueryOptions,
  type ModelQueryResult,
} from './IModelRepository.js';

// Configuration Service
export {
  type IConfigurationService,
  type DeploymentMode,
  type DataSourceConfig,
  type AgencyBrandingConfig,
  type RoleConfig,
  type ExportOptionsConfig,
  type EngineConfig,
  type ApplicationConfig,
} from './IConfigurationService.js';

// Environment Service
export { type IEnvironmentService } from './IEnvironmentService.js';

// Job Queue
export { type IJobQueue } from './IJobQueue.js';

// Model Execution Service
export {
  type IModelExecutionService,
  type ExecutionStatus as JobExecutionStatus,
  type ExecutionOptions as JobExecutionOptions,
} from './IModelExecutionService.js';

// Container Executor (Docker)
export {
  type IContainerExecutor,
  type ContainerRunOptions,
  type ContainerResult,
  type VolumeMount,
  type OutputCallback,
} from './IContainerExecutor.js';

// Input Generator
export {
  type IInputGenerator,
  type InputGenerationResult,
} from './IInputGenerator.js';

// Output Parser
export {
  type IOutputParser,
  type ParsedOutput,
  type ExecutionSummary,
} from './IOutputParser.js';
