/**
 * Domain Value Objects
 *
 * Immutable objects that represent concepts without identity.
 * Value objects are compared by value, not reference.
 */

// Coordinates - geographic position
export { Coordinates } from './Coordinates.js';

// TimeRange - temporal span with duration
export { TimeRange } from './TimeRange.js';

// FWIIndices - Fire Weather Index system components
export { FWIIndices, FireDangerRating } from './FWIIndices.js';

// BoundingBox - geographic extent
export { BoundingBox } from './BoundingBox.js';

// fuelYears - fuel vintage vs dataset year (#431)
export { fuelVintageForDatasetYear } from './fuelYears.js';
