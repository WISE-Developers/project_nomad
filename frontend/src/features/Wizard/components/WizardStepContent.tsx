/**
 * Wizard Step Content Component
 *
 * Wrapper for step content with common layout and header.
 * Responsive design with reduced padding on small screens.
 */

import React, { useState, useEffect } from 'react';
import { useWizard } from '../context/WizardContext';
import { ValidationErrors } from './ValidationErrors';

// Breakpoints
const MOBILE_BREAKPOINT = 480;
const TABLET_BREAKPOINT = 768;

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
 * Adapts padding and font sizes for mobile/tablet screens.
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
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const isTablet = windowWidth < TABLET_BREAKPOINT;

  const containerStyle: React.CSSProperties = {
    flex: 1,
    padding: isMobile ? '16px' : isTablet ? '20px' : '24px',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  };

  const headerStyle: React.CSSProperties = {
    marginBottom: isMobile ? '16px' : '24px',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: isMobile ? '20px' : '24px',
    fontWeight: 600,
    color: '#333',
    margin: 0,
    marginBottom: currentStep.description && showDescription ? '8px' : 0,
  };

  const stepCountStyle: React.CSSProperties = {
    fontSize: isMobile ? '12px' : '14px',
    color: '#666',
    marginBottom: '8px',
  };

  const descriptionStyle: React.CSSProperties = {
    fontSize: isMobile ? '13px' : '14px',
    color: '#666',
    margin: 0,
    lineHeight: 1.5,
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
