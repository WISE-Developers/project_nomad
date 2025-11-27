/**
 * Wizard Feature Module
 *
 * Provides a reusable wizard component system for multi-step workflows.
 */

// Components
export { WizardContainer } from './components/WizardContainer';
export { WizardNavigation } from './components/WizardNavigation';
export { WizardProgress } from './components/WizardProgress';
export { WizardStepContent } from './components/WizardStepContent';
export { ValidationErrors, FieldError } from './components/ValidationErrors';

// Context
export {
  WizardProvider,
  useWizard,
  useWizardValidation,
  useWizardNavigation,
  useWizardData,
} from './context/WizardContext';

// Hooks
export { useWizardState } from './hooks/useWizardState';

// Types
export type {
  WizardStep,
  ValidationResult,
  ValidationError,
  StepValidator,
  StepStatus,
  StepState,
  WizardState,
  NavigationDirection,
  WizardContextValue,
  WizardConfig,
  WizardContainerProps,
  WizardNavigationProps,
  WizardProgressProps,
} from './types';
