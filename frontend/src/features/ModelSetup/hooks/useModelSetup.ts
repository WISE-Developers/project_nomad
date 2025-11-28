/**
 * useModelSetup Hook
 *
 * Factory hook that creates wizard configuration for Model Setup.
 */

import { useMemo } from 'react';
import type { WizardConfig } from '../../Wizard/types';
import type { ModelSetupData } from '../types';
import { MODEL_SETUP_STEPS, DEFAULT_MODEL_SETUP_DATA } from '../types';
import { modelSetupValidators } from '../validators';

export interface UseModelSetupOptions {
  /** Called when wizard completes successfully */
  onComplete?: (data: ModelSetupData) => void | Promise<void>;
  /** Called when wizard is cancelled */
  onCancel?: () => void;
  /** Optional draft ID to resume */
  draftId?: string;
  /** Initial data to pre-populate */
  initialData?: Partial<ModelSetupData>;
}

export interface UseModelSetupReturn {
  /** Wizard configuration */
  config: WizardConfig<ModelSetupData>;
}

/**
 * Creates wizard configuration for Model Setup workflow
 */
export function useModelSetup(options: UseModelSetupOptions = {}): UseModelSetupReturn {
  const { onComplete, onCancel, draftId, initialData } = options;

  const config = useMemo<WizardConfig<ModelSetupData>>(() => {
    return {
      steps: [...MODEL_SETUP_STEPS],
      initialData: {
        ...DEFAULT_MODEL_SETUP_DATA,
        ...initialData,
      },
      draftId,
      storageKey: 'nomad_model_setup',
      validators: modelSetupValidators,
      autoSaveDelay: 500,
      onComplete: async (completeData) => {
        console.log('Model setup complete:', completeData);
        if (onComplete) {
          await onComplete(completeData);
        }
      },
      onCancel: (_cancelData, id) => {
        console.log(`Model setup cancelled. Draft ID: ${id}`);
        onCancel?.();
      },
      onStepChange: (fromIndex, toIndex) => {
        console.log(`Step change: ${fromIndex} -> ${toIndex}`);
      },
    };
  }, [onComplete, onCancel, draftId, initialData]);

  return { config };
}
