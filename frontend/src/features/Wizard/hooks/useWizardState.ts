/**
 * Wizard State Hook
 *
 * Manages wizard form data with localStorage persistence.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getItem,
  setItem,
  removeItem,
  generateDraftId,
} from '../../../shared/utils/storage';
import type {
  WizardState,
  WizardStep,
  StepState,
  ValidationResult,
  StepValidator,
} from '../types';

/**
 * Default validation result (valid)
 */
const VALID_RESULT: ValidationResult = { isValid: true, errors: [] };

/**
 * Options for useWizardState hook
 */
interface UseWizardStateOptions<T> {
  /** Step configurations */
  steps: WizardStep[];
  /** Initial data */
  initialData?: Partial<T>;
  /** Existing draft ID to resume */
  draftId?: string;
  /** Storage key prefix */
  storageKey?: string;
  /** Validators for each step */
  validators?: Record<string, StepValidator<T>>;
  /** Auto-save debounce delay */
  autoSaveDelay?: number;
}

/**
 * Storage key for wizard drafts
 */
const DRAFT_KEY_PREFIX = 'nomad_wizard_draft_';

/**
 * Hook for managing wizard state with persistence
 */
export function useWizardState<T extends Record<string, unknown>>(
  options: UseWizardStateOptions<T>
) {
  const {
    steps,
    initialData = {} as T,
    draftId: existingDraftId,
    storageKey = DRAFT_KEY_PREFIX,
    validators = {},
    autoSaveDelay = 500,
  } = options;

  // Initialize or restore state
  const initializeState = useCallback((): WizardState<T> => {
    // Try to restore from existing draft
    if (existingDraftId) {
      const saved = getItem<WizardState<T>>(`${storageKey}${existingDraftId}`);
      if (saved) {
        return saved;
      }
    }

    // Create new state
    const now = Date.now();
    const draftId = existingDraftId || generateDraftId();

    const stepStates: StepState[] = steps.map((step, index) => ({
      step,
      status: index === 0 ? 'current' : 'pending',
      visited: index === 0,
    }));

    return {
      draftId,
      currentStepIndex: 0,
      steps: stepStates,
      data: initialData as T,
      isComplete: false,
      createdAt: now,
      updatedAt: now,
    };
  }, [existingDraftId, steps, initialData, storageKey]);

  const [state, setState] = useState<WizardState<T>>(initializeState);

  // Debounced save ref
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');

  // Save to localStorage
  const saveToStorage = useCallback((newState: WizardState<T>) => {
    const key = `${storageKey}${newState.draftId}`;
    const serialized = JSON.stringify(newState);

    // Only save if changed
    if (serialized !== lastSavedRef.current) {
      setItem(key, newState);
      lastSavedRef.current = serialized;
    }
  }, [storageKey]);

  // Debounced auto-save
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      saveToStorage(state);
    }, autoSaveDelay);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [state, saveToStorage, autoSaveDelay]);

  // Validate a step
  const validateStep = useCallback(async (stepIndex: number): Promise<ValidationResult> => {
    const stepState = state.steps[stepIndex];
    if (!stepState) return VALID_RESULT;

    const validator = validators[stepState.step.id];
    if (!validator) return VALID_RESULT;

    try {
      const result = await validator(state.data);
      return result;
    } catch (e) {
      return {
        isValid: false,
        errors: [{ message: String(e), type: 'error' }],
      };
    }
  }, [state.steps, state.data, validators]);

  // Update step states based on current index
  const updateStepStates = useCallback((
    currentSteps: StepState[],
    newIndex: number,
    validation?: ValidationResult
  ): StepState[] => {
    return currentSteps.map((s, i) => {
      if (i < newIndex) {
        // Previous steps are completed (unless they had errors)
        return {
          ...s,
          status: s.validation?.isValid === false ? 'error' : 'completed',
          visited: true,
        };
      } else if (i === newIndex) {
        return {
          ...s,
          status: 'current',
          visited: true,
          validation,
        };
      } else {
        // Future steps remain pending/skipped
        return s;
      }
    });
  }, []);

  // Go to next step
  const goNext = useCallback(async (): Promise<boolean> => {
    const { currentStepIndex: current, steps: currentSteps } = state;

    // Validate current step
    const validation = await validateStep(current);
    if (!validation.isValid) {
      setState(prev => ({
        ...prev,
        updatedAt: Date.now(),
        steps: prev.steps.map((s, i) =>
          i === current ? { ...s, validation, status: 'error' } : s
        ),
      }));
      return false;
    }

    // Check if we're on the last step
    if (current >= currentSteps.length - 1) {
      return false;
    }

    const nextIndex = current + 1;
    setState(prev => ({
      ...prev,
      currentStepIndex: nextIndex,
      updatedAt: Date.now(),
      steps: updateStepStates(prev.steps, nextIndex, { isValid: true, errors: [] }),
    }));

    return true;
  }, [state, validateStep, updateStepStates]);

  // Go to previous step
  const goPrev = useCallback(() => {
    setState(prev => {
      if (prev.currentStepIndex === 0) return prev;

      const prevIndex = prev.currentStepIndex - 1;
      return {
        ...prev,
        currentStepIndex: prevIndex,
        updatedAt: Date.now(),
        steps: updateStepStates(prev.steps, prevIndex),
      };
    });
  }, [updateStepStates]);

  // Jump to specific step
  const goToStep = useCallback(async (index: number): Promise<boolean> => {
    if (index < 0 || index >= state.steps.length) return false;

    // Can only jump to visited steps or current step
    const targetStep = state.steps[index];
    if (!targetStep.visited && index > state.currentStepIndex) {
      return false;
    }

    // If jumping forward, validate current step first
    if (index > state.currentStepIndex) {
      const validation = await validateStep(state.currentStepIndex);
      if (!validation.isValid) {
        setState(prev => ({
          ...prev,
          updatedAt: Date.now(),
          steps: prev.steps.map((s, i) =>
            i === prev.currentStepIndex ? { ...s, validation, status: 'error' } : s
          ),
        }));
        return false;
      }
    }

    setState(prev => ({
      ...prev,
      currentStepIndex: index,
      updatedAt: Date.now(),
      steps: updateStepStates(prev.steps, index),
    }));

    return true;
  }, [state.steps, state.currentStepIndex, validateStep, updateStepStates]);

  // Update data
  const updateData = useCallback((data: Partial<T>) => {
    setState(prev => ({
      ...prev,
      data: { ...prev.data, ...data },
      updatedAt: Date.now(),
    }));
  }, []);

  // Set individual field
  const setField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setState(prev => ({
      ...prev,
      data: { ...prev.data, [field]: value },
      updatedAt: Date.now(),
    }));
  }, []);

  // Complete the wizard
  const complete = useCallback(async (): Promise<boolean> => {
    // Validate all steps
    for (let i = 0; i <= state.currentStepIndex; i++) {
      const validation = await validateStep(i);
      if (!validation.isValid) {
        setState(prev => ({
          ...prev,
          currentStepIndex: i,
          updatedAt: Date.now(),
          steps: prev.steps.map((s, idx) =>
            idx === i ? { ...s, validation, status: 'error' } : s
          ),
        }));
        return false;
      }
    }

    setState(prev => ({
      ...prev,
      isComplete: true,
      updatedAt: Date.now(),
      steps: prev.steps.map(s => ({
        ...s,
        status: s.step.optional && !s.visited ? 'skipped' : 'completed',
      })),
    }));

    return true;
  }, [state.currentStepIndex, validateStep]);

  // Cancel and optionally delete draft
  const cancel = useCallback((deleteDraft = false) => {
    if (deleteDraft) {
      removeItem(`${storageKey}${state.draftId}`);
    }
  }, [storageKey, state.draftId]);

  // Delete draft from storage
  const deleteDraft = useCallback(() => {
    removeItem(`${storageKey}${state.draftId}`);
  }, [storageKey, state.draftId]);

  // Force save now
  const saveNow = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveToStorage(state);
  }, [saveToStorage, state]);

  return {
    state,
    currentStep: state.steps[state.currentStepIndex]?.step ?? steps[0],
    currentStepIndex: state.currentStepIndex,
    totalSteps: steps.length,
    isFirstStep: state.currentStepIndex === 0,
    isLastStep: state.currentStepIndex === steps.length - 1,
    goNext,
    goPrev,
    goToStep,
    updateData,
    setField,
    getData: () => state.data,
    complete,
    cancel,
    deleteDraft,
    saveNow,
    validateStep: () => validateStep(state.currentStepIndex),
    getErrors: () => state.steps[state.currentStepIndex]?.validation?.errors ?? [],
  };
}
