/**
 * ModelSetup Feature Module
 *
 * Provides the Model Setup wizard workflow for creating fire model runs.
 */

// Main wizard component
export { ModelSetupWizard } from './components/ModelSetupWizard';

// Sub-components
export { CoordinateInput } from './components/CoordinateInput';
export { GeometryUpload } from './components/GeometryUpload';
export { FWIInput } from './components/FWIInput';
export { WeatherUpload } from './components/WeatherUpload';
export { ModelSummary } from './components/ModelSummary';

// Steps (for advanced usage)
export { SpatialInputStep } from './steps/SpatialInputStep';
export { TemporalStep } from './steps/TemporalStep';
export { ModelSelectionStep } from './steps/ModelSelectionStep';
export { WeatherStep } from './steps/WeatherStep';
export { ReviewStep } from './steps/ReviewStep';

// Hooks
export { useModelSetup } from './hooks/useModelSetup';
export { useGeometrySync } from './hooks/useGeometrySync';

// Types
export type {
  ModelSetupData,
  SpatialData,
  TemporalData,
  ModelData,
  WeatherData,
  ExecutionPreferences,
  ExecutionResult,
  FWIValues,
  BoundingBox,
  SpatialInputMethod,
  FireEngine,
  RunType,
  WeatherSource,
  FireDangerRating,
  ModelSetupStepId,
} from './types';

// Constants and utilities
export {
  MODEL_SETUP_STEPS,
  DEFAULT_MODEL_SETUP_DATA,
  SPRING_STARTUP_FWI,
  CANADA_BOUNDS,
  getFireDangerRating,
  getFireDangerColor,
  isWithinCanada,
} from './types';

// Validators
export { modelSetupValidators } from './validators';
