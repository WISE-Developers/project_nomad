/**
 * Domain Entities
 *
 * Core business objects for the fire modeling system.
 * These entities are framework-agnostic and contain no external dependencies.
 */

// FireModel - core modeling job entity
export {
  FireModel,
  FireModelId,
  createFireModelId,
  EngineType,
  ModelStatus,
  type FireModelProps,
} from './FireModel.js';

// SpatialGeometry - spatial data representation
export {
  SpatialGeometry,
  GeometryType,
  type Position,
  type PointCoordinates,
  type LineStringCoordinates,
  type PolygonCoordinates,
  type Coordinates,
  type BoundingBox,
  type SpatialGeometryProps,
} from './SpatialGeometry.js';

// WeatherData - weather observations with FWI
export {
  WeatherData,
  type FWIComponents,
  type WeatherDataProps,
} from './WeatherData.js';

// FuelType - Canadian FBP fuel types
export {
  FuelType,
  FuelTypeCode,
  type FuelTypeProps,
} from './FuelType.js';

// ModelResult - execution outputs
export {
  ModelResult,
  ModelResultId,
  createModelResultId,
  OutputType,
  OutputFormat,
  type ResultMetadata,
  type ModelResultProps,
} from './ModelResult.js';

// Job - execution job tracking
export {
  Job,
  JobId,
  createJobId,
  JobStatus,
  type JobProps,
} from './Job.js';
