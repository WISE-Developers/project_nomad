/**
 * Wizard Navigation Component
 *
 * Provides navigation buttons for the wizard (Back, Next, Finish, Cancel).
 */

import React, { useCallback, useState } from 'react';
import { useWizard } from '../context/WizardContext';
import type { WizardNavigationProps } from '../types';

/**
 * WizardNavigation renders navigation buttons for the wizard.
 *
 * @example
 * ```tsx
 * <WizardNavigation
 *   backLabel="Previous"
 *   nextLabel="Continue"
 *   finishLabel="Submit"
 *   showCancel
 * />
 * ```
 */
export function WizardNavigation({
  backLabel = 'Back',
  nextLabel = 'Next',
  finishLabel = 'Finish',
  cancelLabel = 'Cancel',
  showCancel = false,
  className = '',
}: WizardNavigationProps) {
  const {
    goNext,
    goPrev,
    complete,
    cancel,
    isFirstStep,
    isLastStep,
    canGoPrev,
  } = useWizard();

  const [isLoading, setIsLoading] = useState(false);

  const handleNext = useCallback(async () => {
    setIsLoading(true);
    try {
      if (isLastStep) {
        await complete();
      } else {
        await goNext();
      }
    } finally {
      setIsLoading(false);
    }
  }, [goNext, complete, isLastStep]);

  const handleBack = useCallback(() => {
    goPrev();
  }, [goPrev]);

  const handleCancel = useCallback(() => {
    cancel(false); // Don't delete draft by default
  }, [cancel]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      handleNext();
    } else if (e.key === 'Escape' && canGoPrev) {
      handleBack();
    }
  }, [handleNext, handleBack, isLoading, canGoPrev]);

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px',
    borderTop: '1px solid #e0e0e0',
    backgroundColor: '#fafafa',
  };

  const buttonGroupStyle: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
  };

  const buttonBaseStyle: React.CSSProperties = {
    padding: '10px 20px',
    borderRadius: '4px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    border: 'none',
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    backgroundColor: '#1976d2',
    color: 'white',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    backgroundColor: 'white',
    color: '#333',
    border: '1px solid #ccc',
  };

  const cancelButtonStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    backgroundColor: 'transparent',
    color: '#666',
    border: 'none',
  };

  const disabledStyle: React.CSSProperties = {
    opacity: 0.5,
    cursor: 'not-allowed',
  };

  return (
    <div
      className={`wizard-navigation ${className}`}
      style={containerStyle}
      onKeyDown={handleKeyDown}
    >
      <div style={buttonGroupStyle}>
        {showCancel && (
          <button
            type="button"
            onClick={handleCancel}
            style={cancelButtonStyle}
            disabled={isLoading}
          >
            {cancelLabel}
          </button>
        )}
      </div>

      <div style={buttonGroupStyle}>
        <button
          type="button"
          onClick={handleBack}
          style={{
            ...secondaryButtonStyle,
            ...(isFirstStep || isLoading ? disabledStyle : {}),
          }}
          disabled={isFirstStep || isLoading}
        >
          {backLabel}
        </button>

        <button
          type="button"
          onClick={handleNext}
          style={{
            ...primaryButtonStyle,
            ...(isLoading ? disabledStyle : {}),
          }}
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : isLastStep ? finishLabel : nextLabel}
        </button>
      </div>
    </div>
  );
}
