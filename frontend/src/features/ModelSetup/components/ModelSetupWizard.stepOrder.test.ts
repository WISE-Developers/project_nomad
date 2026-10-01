/**
 * Step-order tests for ModelSetupWizard.
 *
 * Weather-first wizard: the user supplies weather data BEFORE defining the
 * time range, so the date picker can default to the first datetime in the
 * imported weather instead of today.
 *
 * Target order: spatial → weather → temporal → model → review
 */

import { describe, it, expect } from 'vitest';
import { MODEL_SETUP_STEPS } from '../types/index.js';
import { getStepComponent } from './stepComponents.js';
import { SpatialInputStep } from '../steps/SpatialInputStep.js';
import { WeatherStep } from '../steps/WeatherStep.js';
import { TemporalStep } from '../steps/TemporalStep.js';
import { ModelSelectionStep } from '../steps/ModelSelectionStep.js';
import { ReviewStep } from '../steps/ReviewStep.js';

describe('ModelSetupWizard step order', () => {
  it('places weather before temporal (weather-first wizard)', () => {
    const ids = MODEL_SETUP_STEPS.map((step) => step.id);
    expect(ids).toEqual(['spatial', 'weather', 'temporal', 'model', 'review']);
  });

  it('StepRouter maps each index to the component matching MODEL_SETUP_STEPS[index].id', () => {
    expect(getStepComponent(0)).toBe(SpatialInputStep);
    expect(getStepComponent(1)).toBe(WeatherStep);
    expect(getStepComponent(2)).toBe(TemporalStep);
    expect(getStepComponent(3)).toBe(ModelSelectionStep);
    expect(getStepComponent(4)).toBe(ReviewStep);
    expect(getStepComponent(5)).toBeNull();
  });
});
