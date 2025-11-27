/**
 * Wizard Context
 *
 * Provides wizard state and navigation to all child components.
 */

import { createContext, useContext, useCallback, useEffect, ReactNode } from 'react';
import { useWizardState } from '../hooks/useWizardState';
import type {
  WizardContextValue,
  WizardConfig,
  ValidationResult,
  ValidationError,
} from '../types';

// Create context with generic type
const WizardContext = createContext<WizardContextValue | null>(null);

/**
 * Props for WizardProvider
 */
interface WizardProviderProps<T extends Record<string, unknown>> {
  /** Wizard configuration */
  config: WizardConfig<T>;
  /** Children */
  children: ReactNode;
}

/**
 * Provides wizard context to child components
 */
export function WizardProvider<T extends Record<string, unknown>>({
  config,
  children,
}: WizardProviderProps<T>) {
  const {
    steps,
    initialData,
    draftId,
    storageKey,
    validators,
    onComplete,
    onCancel,
    onStepChange,
    autoSaveDelay,
  } = config;

  const {
    state,
    currentStep,
    currentStepIndex,
    totalSteps,
    isFirstStep,
    isLastStep,
    goNext: stateGoNext,
    goPrev: stateGoPrev,
    goToStep: stateGoToStep,
    updateData,
    setField,
    getData,
    complete: stateComplete,
    cancel: stateCancel,
    validateStep,
    getErrors,
  } = useWizardState<T>({
    steps,
    initialData,
    draftId,
    storageKey,
    validators,
    autoSaveDelay,
  });

  // Previous step index for change detection
  const prevStepIndexRef = { current: currentStepIndex };

  // Trigger step change callback
  useEffect(() => {
    if (prevStepIndexRef.current !== currentStepIndex && onStepChange) {
      onStepChange(prevStepIndexRef.current, currentStepIndex, state.data);
    }
    prevStepIndexRef.current = currentStepIndex;
  }, [currentStepIndex, onStepChange, state.data]);

  // Wrapped goNext with step change callback
  const goNext = useCallback(async (): Promise<boolean> => {
    const success = await stateGoNext();
    return success;
  }, [stateGoNext]);

  // Wrapped goPrev
  const goPrev = useCallback(() => {
    stateGoPrev();
  }, [stateGoPrev]);

  // Wrapped goToStep
  const goToStep = useCallback(async (index: number): Promise<boolean> => {
    const success = await stateGoToStep(index);
    return success;
  }, [stateGoToStep]);

  // Complete with callback
  const complete = useCallback(async (): Promise<boolean> => {
    const success = await stateComplete();
    if (success && onComplete) {
      await onComplete(state.data);
    }
    return success;
  }, [stateComplete, onComplete, state.data]);

  // Cancel with callback
  const cancel = useCallback((deleteDraft = false) => {
    if (onCancel) {
      onCancel(state.data, state.draftId);
    }
    stateCancel(deleteDraft);
  }, [onCancel, stateCancel, state.data, state.draftId]);

  // Validation result for current step
  const currentValidation = state.steps[currentStepIndex]?.validation;
  const canGoNext = currentValidation?.isValid !== false;
  const canGoPrev = !isFirstStep;

  const value: WizardContextValue<T> = {
    state,
    currentStep,
    currentStepIndex,
    totalSteps,
    isFirstStep,
    isLastStep,
    canGoNext,
    canGoPrev,
    goNext,
    goPrev,
    goToStep,
    updateData,
    setField,
    getData,
    complete,
    cancel,
    validateStep,
    getErrors,
  };

  return (
    <WizardContext.Provider value={value as WizardContextValue}>
      {children}
    </WizardContext.Provider>
  );
}

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
