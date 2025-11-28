/**
 * ModelSetup Validators
 *
 * Step validators for the Model Setup wizard.
 */

import type { StepValidator, ValidationResult } from '../../Wizard/types';
import type { ModelSetupData, BoundingBox } from '../types';
import { CANADA_BOUNDS, isWithinCanada } from '../types';

/**
 * Calculate bounding box from features array
 */
function getBoundsFromFeatures(features: GeoJSON.Feature[]): BoundingBox | null {
  if (!features.length) return null;

  // Get all coordinates from all features
  const allCoords: [number, number][] = [];

  for (const feature of features) {
    const geom = feature.geometry;
    if (geom.type === 'Point') {
      allCoords.push(geom.coordinates as [number, number]);
    } else if (geom.type === 'LineString') {
      allCoords.push(...(geom.coordinates as [number, number][]));
    } else if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) {
        allCoords.push(...(ring as [number, number][]));
      }
    }
  }

  if (!allCoords.length) return null;

  const lngs = allCoords.map((c) => c[0]);
  const lats = allCoords.map((c) => c[1]);

  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/**
 * Validate spatial input step
 */
export const spatialValidator: StepValidator<ModelSetupData> = (data): ValidationResult => {
  const errors: ValidationResult['errors'] = [];

  // Check if any features exist
  if (!data.geometry?.features?.length) {
    errors.push({
      message: 'Please select a fire location by drawing on the map, entering coordinates, or uploading a file',
      type: 'error',
    });
    return { isValid: false, errors };
  }

  // Calculate and check bounds
  const bounds = getBoundsFromFeatures(data.geometry.features);
  if (bounds && !isWithinCanada(bounds)) {
    errors.push({
      message: `Location must be within Canada (${CANADA_BOUNDS[0]}° to ${CANADA_BOUNDS[2]}° longitude, ${CANADA_BOUNDS[1]}° to ${CANADA_BOUNDS[3]}° latitude)`,
      type: 'error',
    });
    return { isValid: false, errors };
  }

  return { isValid: true, errors: [] };
};

/**
 * Validate temporal parameters step
 */
export const temporalValidator: StepValidator<ModelSetupData> = (data): ValidationResult => {
  const errors: ValidationResult['errors'] = [];

  if (!data.temporal?.startDate) {
    errors.push({
      field: 'startDate',
      message: 'Please select a start date',
      type: 'error',
    });
  }

  if (!data.temporal?.startTime) {
    errors.push({
      field: 'startTime',
      message: 'Please select a start time',
      type: 'error',
    });
  }

  if (!data.temporal?.durationHours || data.temporal.durationHours < 1) {
    errors.push({
      field: 'durationHours',
      message: 'Duration must be at least 1 hour',
      type: 'error',
    });
  }

  if (data.temporal?.durationHours && data.temporal.durationHours > 720) {
    errors.push({
      field: 'durationHours',
      message: 'Duration cannot exceed 720 hours (30 days)',
      type: 'error',
    });
  }

  return { isValid: errors.length === 0, errors };
};

/**
 * Validate model selection step
 */
export const modelValidator: StepValidator<ModelSetupData> = (data): ValidationResult => {
  const errors: ValidationResult['errors'] = [];

  if (!data.model?.engine) {
    errors.push({
      field: 'engine',
      message: 'Please select a fire model',
      type: 'error',
    });
  }

  if (!data.model?.runType) {
    errors.push({
      field: 'runType',
      message: 'Please select a run type (deterministic or probabilistic)',
      type: 'error',
    });
  }

  // WISE is not available for MVP
  if (data.model?.engine === 'wise') {
    errors.push({
      field: 'engine',
      message: 'WISE engine is not yet available. Please select FireSTARR.',
      type: 'error',
    });
  }

  return { isValid: errors.length === 0, errors };
};

/**
 * Validate weather data step
 */
export const weatherValidator: StepValidator<ModelSetupData> = (data): ValidationResult => {
  const errors: ValidationResult['errors'] = [];

  if (!data.weather?.source) {
    errors.push({
      message: 'Please select a weather data source',
      type: 'error',
    });
    return { isValid: false, errors };
  }

  if (data.weather.source === 'manual') {
    if (!data.weather.fwi) {
      errors.push({
        message: 'Please enter FWI values',
        type: 'error',
      });
      return { isValid: false, errors };
    }

    const { ffmc, dmc, dc, isi, bui, fwi } = data.weather.fwi;

    // FFMC validation (0-101)
    if (ffmc === undefined || ffmc === null || isNaN(ffmc)) {
      errors.push({ field: 'ffmc', message: 'FFMC is required', type: 'error' });
    } else if (ffmc < 0 || ffmc > 101) {
      errors.push({ field: 'ffmc', message: 'FFMC must be between 0 and 101', type: 'error' });
    }

    // DMC validation (0+)
    if (dmc === undefined || dmc === null || isNaN(dmc)) {
      errors.push({ field: 'dmc', message: 'DMC is required', type: 'error' });
    } else if (dmc < 0) {
      errors.push({ field: 'dmc', message: 'DMC cannot be negative', type: 'error' });
    }

    // DC validation (0+)
    if (dc === undefined || dc === null || isNaN(dc)) {
      errors.push({ field: 'dc', message: 'DC is required', type: 'error' });
    } else if (dc < 0) {
      errors.push({ field: 'dc', message: 'DC cannot be negative', type: 'error' });
    }

    // ISI validation (0+)
    if (isi === undefined || isi === null || isNaN(isi)) {
      errors.push({ field: 'isi', message: 'ISI is required', type: 'error' });
    } else if (isi < 0) {
      errors.push({ field: 'isi', message: 'ISI cannot be negative', type: 'error' });
    }

    // BUI validation (0+)
    if (bui === undefined || bui === null || isNaN(bui)) {
      errors.push({ field: 'bui', message: 'BUI is required', type: 'error' });
    } else if (bui < 0) {
      errors.push({ field: 'bui', message: 'BUI cannot be negative', type: 'error' });
    }

    // FWI validation (0+)
    if (fwi === undefined || fwi === null || isNaN(fwi)) {
      errors.push({ field: 'fwi', message: 'FWI is required', type: 'error' });
    } else if (fwi < 0) {
      errors.push({ field: 'fwi', message: 'FWI cannot be negative', type: 'error' });
    }
  }

  if (data.weather.source === 'upload' && !data.weather.uploadedFile) {
    errors.push({
      message: 'Please upload a weather data file',
      type: 'error',
    });
  }

  if (data.weather.source === 'spotwx') {
    errors.push({
      message: 'SpotWX integration is coming soon. Please use manual entry for now.',
      type: 'error',
    });
  }

  return { isValid: errors.length === 0, errors };
};

/**
 * All validators keyed by step ID
 */
export const modelSetupValidators: Record<string, StepValidator<ModelSetupData>> = {
  spatial: spatialValidator,
  temporal: temporalValidator,
  model: modelValidator,
  weather: weatherValidator,
  // review step doesn't need validation - all prior steps are validated
};
