/**
 * stepComponents — maps ModelSetup wizard step ids to their step components.
 *
 * Split out of ModelSetupWizard.tsx so that file exports only the component
 * (react-refresh/only-export-components); this lookup has no JSX component
 * identity of its own to preserve across fast-refresh reloads.
 *
 * @module features/ModelSetup/components/stepComponents
 */

import React from 'react';
import { SpatialInputStep } from '../steps/SpatialInputStep';
import { TemporalStep } from '../steps/TemporalStep';
import { ModelSelectionStep } from '../steps/ModelSelectionStep';
import { WeatherStep } from '../steps/WeatherStep';
import { ReviewStep } from '../steps/ReviewStep';
import type { ModelSetupStepId } from '../types';
import { MODEL_SETUP_STEPS } from '../types';

const STEP_COMPONENTS_BY_ID: Record<ModelSetupStepId, React.ComponentType> = {
  spatial: SpatialInputStep,
  weather: WeatherStep,
  temporal: TemporalStep,
  model: ModelSelectionStep,
  review: ReviewStep,
};

/**
 * Returns the step component for a given wizard step index, derived from
 * MODEL_SETUP_STEPS order. Returns null if the index is out of range.
 */
export function getStepComponent(index: number): React.ComponentType | null {
  const step = MODEL_SETUP_STEPS[index];
  if (!step) return null;
  return STEP_COMPONENTS_BY_ID[step.id] ?? null;
}
