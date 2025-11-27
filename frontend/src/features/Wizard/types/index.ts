/**
 * Wizard Types
 *
 * Core type definitions for the reusable wizard component system.
 */

/**
 * Wizard step configuration
 */
export interface WizardStep {
  /** Unique identifier for this step */
  id: string;
  /** Display name for the step */
  name: string;
  /** Optional description */
  description?: string;
  /** Whether this step can be skipped */
  optional?: boolean;
  /** Icon for the step (emoji or icon name) */
  icon?: string;
}

/**
 * Step validation result
 */
export interface ValidationResult {
  /** Whether the step is valid */
  isValid: boolean;
  /** Array of error messages */
  errors: ValidationError[];
}

/**
 * Individual validation error
 */
export interface ValidationError {
  /** Field that has the error (optional) */
  field?: string;
  /** Error message */
  message: string;
  /** Error type for styling */
  type: 'error' | 'warning';
}

/**
 * Step validator function type
 */
export type StepValidator<T = unknown> = (data: T) => ValidationResult | Promise<ValidationResult>;

/**
 * Wizard step status
 */
export type StepStatus = 'pending' | 'current' | 'completed' | 'error' | 'skipped';

/**
 * Internal step state
 */
export interface StepState {
  /** Step configuration */
  step: WizardStep;
  /** Current status */
  status: StepStatus;
  /** Validation result if validated */
  validation?: ValidationResult;
  /** Whether this step has been visited */
  visited: boolean;
}

/**
 * Wizard state
 */
export interface WizardState<T = Record<string, unknown>> {
  /** Unique draft ID */
  draftId: string;
  /** Current step index */
  currentStepIndex: number;
  /** All step states */
  steps: StepState[];
  /** Form data for all steps */
  data: T;
  /** Whether the wizard is complete */
  isComplete: boolean;
  /** When this draft was created */
  createdAt: number;
  /** When this draft was last modified */
  updatedAt: number;
}

/**
 * Wizard navigation direction
 */
export type NavigationDirection = 'next' | 'prev' | 'jump';

/**
 * Wizard context value
 */
export interface WizardContextValue<T = Record<string, unknown>> {
  /** Current wizard state */
  state: WizardState<T>;
  /** Current step configuration */
  currentStep: WizardStep;
  /** Current step index */
  currentStepIndex: number;
  /** Total number of steps */
  totalSteps: number;
  /** Whether on the first step */
  isFirstStep: boolean;
  /** Whether on the last step */
  isLastStep: boolean;
  /** Whether can go to next step (passes validation) */
  canGoNext: boolean;
  /** Whether can go to previous step */
  canGoPrev: boolean;
  /** Go to next step */
  goNext: () => Promise<boolean>;
  /** Go to previous step */
  goPrev: () => void;
  /** Jump to a specific step by index */
  goToStep: (index: number) => Promise<boolean>;
  /** Update data for current step */
  updateData: (data: Partial<T>) => void;
  /** Set data for a specific field */
  setField: <K extends keyof T>(field: K, value: T[K]) => void;
  /** Get current step's data */
  getData: () => T;
  /** Complete the wizard */
  complete: () => Promise<boolean>;
  /** Cancel and optionally delete draft */
  cancel: (deleteDraft?: boolean) => void;
  /** Validate current step */
  validateStep: () => Promise<ValidationResult>;
  /** Get validation errors for current step */
  getErrors: () => ValidationError[];
}

/**
 * Wizard configuration
 */
export interface WizardConfig<T = Record<string, unknown>> {
  /** Steps configuration */
  steps: WizardStep[];
  /** Initial data */
  initialData?: Partial<T>;
  /** Existing draft ID to resume */
  draftId?: string;
  /** Storage key prefix */
  storageKey?: string;
  /** Validators for each step (keyed by step id) */
  validators?: Record<string, StepValidator<T>>;
  /** Callback when wizard completes */
  onComplete?: (data: T) => void | Promise<void>;
  /** Callback when wizard is cancelled */
  onCancel?: (data: T, draftId: string) => void;
  /** Callback on step change */
  onStepChange?: (fromIndex: number, toIndex: number, data: T) => void;
  /** Auto-save debounce delay in ms (default: 500) */
  autoSaveDelay?: number;
}

/**
 * Props for wizard container
 */
export interface WizardContainerProps<T = Record<string, unknown>> {
  /** Wizard configuration */
  config: WizardConfig<T>;
  /** Children render function or React nodes */
  children: React.ReactNode | ((context: WizardContextValue<T>) => React.ReactNode);
  /** CSS class for the container */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
}

/**
 * Props for wizard navigation
 */
export interface WizardNavigationProps {
  /** Custom label for back button */
  backLabel?: string;
  /** Custom label for next button */
  nextLabel?: string;
  /** Custom label for finish button */
  finishLabel?: string;
  /** Custom label for cancel button */
  cancelLabel?: string;
  /** Show cancel button */
  showCancel?: boolean;
  /** CSS class */
  className?: string;
}

/**
 * Props for wizard progress
 */
export interface WizardProgressProps {
  /** Layout direction */
  direction?: 'horizontal' | 'vertical';
  /** Show step numbers */
  showNumbers?: boolean;
  /** Allow clicking to jump to completed steps */
  allowJump?: boolean;
  /** CSS class */
  className?: string;
}
