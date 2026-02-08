/**
 * Wizard Navigation Component
 *
 * Provides navigation buttons for the wizard (Back, Next, Finish, Cancel).
 * Responsive design with compact buttons on mobile.
 */

import React, { useCallback, useState, useEffect } from 'react';
import { useWizard } from '../context/WizardContext';
import type { WizardNavigationProps } from '../types';

// Breakpoints
const MOBILE_BREAKPOINT = 480;
const TABLET_BREAKPOINT = 768;

/**
 * WizardNavigation renders navigation buttons for the wizard.
 * Adapts to screen size with compact buttons on mobile.
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
    padding: isMobile ? '12px 16px' : isTablet ? '14px 16px' : '16px',
    borderTop: '1px solid #e0e0e0',
    backgroundColor: '#fafafa',
    gap: '8px',
    flexWrap: 'nowrap',
  };

  const buttonGroupStyle: React.CSSProperties = {
    display: 'flex',
    gap: isMobile ? '6px' : '8px',
    flexShrink: 0,
  };

  const buttonBaseStyle: React.CSSProperties = {
    padding: isMobile ? '10px 14px' : isTablet ? '10px 16px' : '10px 20px',
    borderRadius: '4px',
    fontSize: isMobile ? '13px' : '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    border: 'none',
    whiteSpace: 'nowrap',
  };

  const primaryButtonStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    backgroundColor: '#1976d2',
    color: 'white',
    minWidth: isMobile ? 'auto' : '80px',
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
    padding: isMobile ? '10px 8px' : buttonBaseStyle.padding,
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
