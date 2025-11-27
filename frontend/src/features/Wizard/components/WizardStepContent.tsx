/**
 * Wizard Step Content Component
 *
 * Wrapper for step content with common layout and header.
 */

import React from 'react';
import { useWizard } from '../context/WizardContext';
import { ValidationErrors } from './ValidationErrors';

/**
 * Props for WizardStepContent
 */
interface WizardStepContentProps {
  /** Step content */
  children: React.ReactNode;
  /** Show step title */
  showTitle?: boolean;
  /** Show step description */
  showDescription?: boolean;
  /** Show validation errors */
  showErrors?: boolean;
  /** CSS class */
  className?: string;
}

/**
 * WizardStepContent provides consistent layout for step content.
 *
 * @example
 * ```tsx
 * <WizardStepContent showTitle showDescription>
 *   <form>
 *     <input name="field1" />
 *   </form>
 * </WizardStepContent>
 * ```
 */
export function WizardStepContent({
  children,
  showTitle = true,
  showDescription = true,
  showErrors = true,
  className = '',
}: WizardStepContentProps) {
  const { currentStep, currentStepIndex, totalSteps } = useWizard();

  const containerStyle: React.CSSProperties = {
    flex: 1,
    padding: '24px',
    overflowY: 'auto',
  };

  const headerStyle: React.CSSProperties = {
    marginBottom: '24px',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '24px',
    fontWeight: 600,
    color: '#333',
    margin: 0,
    marginBottom: currentStep.description && showDescription ? '8px' : 0,
  };

  const stepCountStyle: React.CSSProperties = {
    fontSize: '14px',
    color: '#666',
    marginBottom: '8px',
  };

  const descriptionStyle: React.CSSProperties = {
    fontSize: '14px',
    color: '#666',
    margin: 0,
  };

  return (
    <div className={`wizard-step-content ${className}`} style={containerStyle}>
      {(showTitle || showDescription) && (
        <div style={headerStyle}>
          <div style={stepCountStyle}>
            Step {currentStepIndex + 1} of {totalSteps}
          </div>
          {showTitle && <h2 style={titleStyle}>{currentStep.name}</h2>}
          {showDescription && currentStep.description && (
            <p style={descriptionStyle}>{currentStep.description}</p>
          )}
        </div>
      )}

      {showErrors && <ValidationErrors />}

      {children}
    </div>
  );
}
