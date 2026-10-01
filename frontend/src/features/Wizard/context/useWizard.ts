/**
 * Wizard hooks — access wizard state, navigation, validation, and data from
 * the nearest WizardProvider.
 *
 * Split out of WizardProvider.tsx so that file exports only the component
 * (react-refresh/only-export-components).
 */

import { useContext } from 'react';
import { WizardContext } from './WizardContext';
import type { WizardContextValue, ValidationResult, ValidationError } from '../types';

/**
 * Hook to access wizard context
 *
 * @throws Error if used outside of WizardProvider
 */
export function useWizard<T extends Record<string, unknown> = Record<string, unknown>>(): WizardContextValue<T> {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error('useWizard must be used within a WizardProvider');
  }
  return context as WizardContextValue<T>;
}

/**
 * Hook to access wizard validation
 */
export function useWizardValidation(): {
  validateStep: () => Promise<ValidationResult>;
  getErrors: () => ValidationError[];
  hasErrors: boolean;
} {
  const { validateStep, getErrors, state, currentStepIndex } = useWizard();
  const currentValidation = state.steps[currentStepIndex]?.validation;

  return {
    validateStep,
    getErrors,
    hasErrors: currentValidation?.isValid === false,
  };
}

/**
 * Hook to access wizard navigation
 */
export function useWizardNavigation() {
  const {
    goNext,
    goPrev,
    goToStep,
    complete,
    cancel,
    isFirstStep,
    isLastStep,
    canGoNext,
    canGoPrev,
    currentStepIndex,
    totalSteps,
  } = useWizard();

  return {
    goNext,
    goPrev,
    goToStep,
    complete,
    cancel,
    isFirstStep,
    isLastStep,
    canGoNext,
    canGoPrev,
    currentStepIndex,
    totalSteps,
  };
}

/**
 * Hook to access wizard data
 */
export function useWizardData<T extends Record<string, unknown> = Record<string, unknown>>() {
  const { getData, updateData, setField } = useWizard<T>();

  return {
    data: getData(),
    updateData,
    setField,
  };
}
