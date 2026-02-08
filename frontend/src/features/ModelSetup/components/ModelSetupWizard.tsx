/**
 * ModelSetupWizard Component
 *
 * Main wizard wrapper for the Model Setup workflow.
 * Draggable and resizable panel on desktop, full-screen on mobile.
 *
 * Responsive behavior:
 * - Mobile (<480px): Full-screen overlay with fixed footer
 * - Tablet (<768px): Smaller panel, reduced padding
 * - Desktop: Draggable/resizable panel
 */

import React, { useCallback, useState, useEffect } from 'react';
import { Rnd } from 'react-rnd';
import {
  WizardContainer,
  WizardProgress,
  WizardStepContent,
  WizardNavigation,
  useWizard,
} from '../../Wizard';
import { useModelSetup } from '../hooks/useModelSetup';
import { SpatialInputStep } from '../steps/SpatialInputStep';
import { TemporalStep } from '../steps/TemporalStep';
import { ModelSelectionStep } from '../steps/ModelSelectionStep';
import { WeatherStep } from '../steps/WeatherStep';
import { ReviewStep } from '../steps/ReviewStep';
import type { ModelSetupData } from '../types';

export interface ModelSetupWizardProps {
  /** Called when model setup completes */
  onComplete?: (data: ModelSetupData) => void | Promise<void>;
  /** Called when wizard is cancelled */
  onCancel?: () => void;
  /** Optional draft ID to resume */
  draftId?: string;
}

// Breakpoints
const MOBILE_BREAKPOINT = 480;
const TABLET_BREAKPOINT = 768;

// Desktop dimensions
const DEFAULT_WIDTH = 690;
const DEFAULT_HEIGHT = 1040;
const MIN_WIDTH = 380;
const MIN_HEIGHT = 400;
const VIEWPORT_MARGIN = 40;

// Custom hook for responsive behavior
function useResponsive() {
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    windowSize,
    isMobile: windowSize.width < MOBILE_BREAKPOINT,
    isTablet: windowSize.width < TABLET_BREAKPOINT,
  };
}

// Styles factory based on responsive state
function getStyles(isMobile: boolean, isTablet: boolean) {
  const wizardInnerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    backgroundColor: 'white',
    borderRadius: isMobile ? '0' : '12px',
    boxShadow: isMobile ? 'none' : '0 4px 20px rgba(0, 0, 0, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    padding: isMobile ? '12px 16px' : isTablet ? '14px 16px' : '16px 20px',
    borderBottom: '1px solid #eee',
    backgroundColor: '#f8f9fa',
    cursor: isMobile ? 'default' : 'move',
    userSelect: 'none',
    borderRadius: isMobile ? '0' : '12px 12px 0 0',
    flexShrink: 0,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: isMobile ? '16px' : '18px',
    fontWeight: 'bold',
    color: '#333',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const dragHintStyle: React.CSSProperties = {
    fontSize: '10px',
    color: '#999',
    fontWeight: 'normal',
    display: isMobile ? 'none' : 'inline',
  };

  const progressWrapperStyle: React.CSSProperties = {
    borderBottom: '1px solid #eee',
    flexShrink: 0,
    overflow: 'hidden',
  };

  const contentWrapperStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    padding: '0',
    WebkitOverflowScrolling: 'touch',
  };

  const footerStyle: React.CSSProperties = {
    flexShrink: 0,
    borderTop: '1px solid #eee',
    backgroundColor: '#f8f9fa',
    // On mobile, add safe area padding for home indicator
    paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : '0',
  };

  const bottomDragHandleStyle: React.CSSProperties = {
    padding: '6px 16px',
    backgroundColor: '#f0f1f3',
    borderTop: '1px solid #e0e0e0',
    cursor: 'move',
    userSelect: 'none',
    borderRadius: isMobile ? '0' : '0 0 12px 12px',
    display: isMobile ? 'none' : 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    fontSize: '11px',
    color: '#666',
  };

  const closeButtonStyle: React.CSSProperties = {
    display: isMobile ? 'flex' : 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    background: 'none',
    border: 'none',
    fontSize: '20px',
    color: '#666',
    cursor: 'pointer',
    borderRadius: '4px',
  };

  return {
    wizardInnerStyle,
    headerStyle,
    titleStyle,
    dragHintStyle,
    progressWrapperStyle,
    contentWrapperStyle,
    footerStyle,
    bottomDragHandleStyle,
    closeButtonStyle,
  };
}

/**
 * Step router component - renders the correct step based on current index
 */
function StepRouter() {
  const { currentStepIndex } = useWizard<ModelSetupData>();

  switch (currentStepIndex) {
    case 0:
      return <SpatialInputStep />;
    case 1:
      return <TemporalStep />;
    case 2:
      return <ModelSelectionStep />;
    case 3:
      return <WeatherStep />;
    case 4:
      return <ReviewStep />;
    default:
      return null;
  }
}

/**
 * Model Setup Wizard component
 */
export function ModelSetupWizard({ onComplete, onCancel, draftId }: ModelSetupWizardProps) {
  const { windowSize, isMobile, isTablet } = useResponsive();
  const styles = getStyles(isMobile, isTablet);

  // Calculate initial dimensions - respect viewport size
  const [initialDimensions] = useState(() => {
    const maxHeight = window.innerHeight - VIEWPORT_MARGIN;
    const height = Math.min(DEFAULT_HEIGHT, maxHeight);
    const width = Math.min(DEFAULT_WIDTH, window.innerWidth - VIEWPORT_MARGIN);
    const x = Math.max(VIEWPORT_MARGIN / 2, (window.innerWidth - width) / 2);
    const y = Math.max(VIEWPORT_MARGIN / 2, (window.innerHeight - height) / 2);
    return { x, y, width, height };
  });

  const [size, setSize] = useState({
    width: initialDimensions.width,
    height: initialDimensions.height
  });

  const handleComplete = useCallback(
    async (data: ModelSetupData) => {
      console.log('Model setup complete:', data);

      // For MVP, just log the data
      // In Phase 6, this will call the backend API
      if (onComplete) {
        await onComplete(data);
      }
    },
    [onComplete]
  );

  const handleCancel = useCallback(() => {
    console.log('Model setup cancelled');
    onCancel?.();
  }, [onCancel]);

  const { config } = useModelSetup({
    onComplete: handleComplete,
    onCancel: handleCancel,
    draftId,
  });

  // Mobile: Full-screen overlay
  if (isMobile) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1000,
          backgroundColor: 'white',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <WizardContainer config={config}>
          {/* Header with close button */}
          <div style={styles.headerStyle}>
            <h2 style={styles.titleStyle}>
              <span><i className="fa-solid fa-fire" style={{ marginRight: '8px' }} />New Fire Model</span>
              <button
                type="button"
                style={styles.closeButtonStyle}
                onClick={onCancel}
                aria-label="Close wizard"
              >
                ×
              </button>
            </h2>
          </div>

          {/* Progress indicator - compact on mobile */}
          <div style={styles.progressWrapperStyle}>
            <WizardProgress
              direction="horizontal"
              showNumbers={true}
              allowJump={false}
            />
          </div>

          {/* Step content - scrollable */}
          <div style={styles.contentWrapperStyle}>
            <WizardStepContent showTitle={true} showDescription={true} showErrors={true}>
              <StepRouter />
            </WizardStepContent>
          </div>

          {/* Navigation - fixed at bottom */}
          <div style={styles.footerStyle}>
            <WizardNavigation
              backLabel="Back"
              nextLabel="Continue"
              finishLabel="Start Model"
              cancelLabel="Cancel"
              showCancel={false}
            />
          </div>
        </WizardContainer>
      </div>
    );
  }

  // Tablet/Desktop: Draggable/resizable panel
  // Adjust dimensions for tablet
  const effectiveMinWidth = isTablet ? 320 : MIN_WIDTH;
  const effectiveMaxWidth = isTablet ? windowSize.width - 20 : 800;
  const effectiveMaxHeight = windowSize.height - (isTablet ? 20 : VIEWPORT_MARGIN);

  return (
    <Rnd
      default={{
        x: initialDimensions.x,
        y: initialDimensions.y,
        width: isTablet ? Math.min(initialDimensions.width, windowSize.width - 20) : initialDimensions.width,
        height: isTablet ? Math.min(initialDimensions.height, windowSize.height - 20) : initialDimensions.height,
      }}
      minWidth={effectiveMinWidth}
      minHeight={MIN_HEIGHT}
      maxWidth={effectiveMaxWidth}
      maxHeight={effectiveMaxHeight}
      bounds="parent"
      dragHandleClassName="wizard-drag-handle"
      style={{ zIndex: 1000 }}
      onResize={(_e, _direction, ref) => {
        setSize({
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        });
      }}
      enableResizing={{
        top: false,
        right: true,
        bottom: true,
        left: true,
        topRight: false,
        bottomRight: true,
        bottomLeft: true,
        topLeft: false,
      }}
    >
      <div style={{ ...styles.wizardInnerStyle, width: size.width, height: size.height }}>
        <WizardContainer config={config}>
          {/* Header - Top Drag Handle */}
          <div style={styles.headerStyle} className="wizard-drag-handle">
            <h2 style={styles.titleStyle}>
              <span><i className="fa-solid fa-fire" style={{ marginRight: '8px' }} />New Fire Model</span>
              <span style={styles.dragHintStyle}>drag to move</span>
            </h2>
          </div>

          {/* Progress indicator */}
          <div style={styles.progressWrapperStyle}>
            <WizardProgress
              direction="horizontal"
              showNumbers={true}
              allowJump={false}
            />
          </div>

          {/* Step content */}
          <div style={styles.contentWrapperStyle}>
            <WizardStepContent showTitle={true} showDescription={true} showErrors={true}>
              <StepRouter />
            </WizardStepContent>
          </div>

          {/* Navigation */}
          <div style={styles.footerStyle}>
            <WizardNavigation
              backLabel="Back"
              nextLabel="Continue"
              finishLabel="Start Model"
              cancelLabel="Cancel"
              showCancel={true}
            />
          </div>

          {/* Bottom Drag Handle - hidden on tablet/mobile */}
          <div style={styles.bottomDragHandleStyle} className="wizard-drag-handle">
            <i className="fa-solid fa-grip-lines" />
            <span>drag to move</span>
          </div>
        </WizardContainer>
      </div>
    </Rnd>
  );
}
