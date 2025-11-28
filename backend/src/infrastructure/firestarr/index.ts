/**
 * FireSTARR Infrastructure
 *
 * Complete FireSTARR fire modeling engine integration.
 */

// Engine
export {
  FireSTARREngine,
  getFireSTARREngine,
  resetFireSTARREngine,
} from './FireSTARREngine.js';

// Input Generation
export {
  FireSTARRInputGenerator,
  createFireSTARRInputGenerator,
  type FireSTARRInputConfig,
} from './FireSTARRInputGenerator.js';

// Output Parsing
export {
  FireSTARROutputParser,
  getFireSTARROutputParser,
} from './FireSTARROutputParser.js';

// Weather CSV
export {
  writeWeatherCSV,
  validateWeatherData,
  type WeatherCSVOptions,
} from './WeatherCSVWriter.js';

// Perimeter Rasterization
export {
  rasterizePerimeter,
  isGDALAvailable,
  type RasterizeOptions,
  type RasterizeResult,
} from './PerimeterRasterizer.js';

// Contour Generation
export {
  generateContours,
  clearContourCache,
} from './ContourGenerator.js';

// Types
export {
  type WeatherHourlyData,
  type FireSTARRParams,
  type FireSTARRCommand,
  FIRESTARR_OUTPUT_PATTERNS,
  FIRESTARR_SUCCESS_PATTERN,
  FIRESTARR_ERROR_PATTERNS,
  FIRESTARR_WARNING_PATTERNS,
  FIRESTARR_PROGRESS_PATTERNS,
} from './types.js';
