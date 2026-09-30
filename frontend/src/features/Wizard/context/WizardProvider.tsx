/**
 * Wizard Context
 *
 * Provides wizard state and navigation to all child components.
 */

import { useCallback, useEffect, useRef, ReactNode } from 'react';
import { useWizardState } from '../hooks/useWizardState';
import type { WizardContextValue, WizardConfig } from '../types';
import { WizardContext } from './WizardContext';

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
  // A real ref, not an object literal — issue #393. Written as
  // `{ current: currentStepIndex }` this was rebuilt every render with
  // `current` already equal to the current index, so the guard below could
  // never be true and onStepChange never fired for any consumer.
  const prevStepIndexRef = useRef(currentStepIndex);

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
