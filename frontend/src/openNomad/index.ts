/**
 * openNomad API Module
 *
 * The communication layer between the Dashboard component and backend services.
 *
 * ## Quick Start
 *
 * ```tsx
 * import { OpenNomadProvider, useOpenNomad, createDefaultAdapter } from '@/openNomad';
 *
 * // Wrap your app with the provider
 * function App() {
 *   const adapter = useMemo(() => createDefaultAdapter(), []);
 *   return (
 *     <OpenNomadProvider adapter={adapter}>
 *       <YourApp />
 *     </OpenNomadProvider>
 *   );
 * }
 *
 * // Use the API in components
 * function ModelsList() {
 *   const api = useOpenNomad();
 *   // api.models.list(), api.jobs.getStatus(), etc.
 * }
 * ```
 *
 * @module openNomad
 */

// Context and hooks
export {
  OpenNomadProvider,
  useOpenNomad,
  useOpenNomadOptional,
  type OpenNomadProviderProps,
} from './context/index.js';

// Default implementation (SAN mode)
export {
  createDefaultAdapter,
  type DefaultAdapterOptions,
} from './default/index.js';

// Example adapter template (for ACN implementations)
export {
  createAgencyAdapter,
  type AgencyAdapterOptions,
  // Integration pattern examples
  EmbeddedNomadDashboard,
  StyledEmbeddedDashboard,
  TokenRefreshDashboard,
} from './examples/index.js';

// Re-export all types and the main interface
export type {
  // Common types
  BBox,
  GeoJSONGeometry,
  PaginationParams,
  PaginatedResponse,
  Unsubscribe,

  // Auth types
  User,
  UserRole,

  // Model types
  EngineType,
  ModelStatus,
  Model,
  ModelCreateParams,
  TemporalParams,
  WeatherParams,
  FWIStartingCodes,
  OutputParams,
  ModelFilter,

  // Job types
  JobStatus,
  Job,
  JobStatusDetail,

  // Result types
  OutputType,
  ModelResult,
  ResultMetadata,
  ModelResults,
  ExportFormat,
  ExportParams,

  // Spatial types
  WeatherStation,
  FuelTypeData,
  FuelType,
  ElevationData,

  // Config types
  Engine,
  AgencyConfig,

  // Main API interface
  IOpenNomadAPI,
} from './api.js';
