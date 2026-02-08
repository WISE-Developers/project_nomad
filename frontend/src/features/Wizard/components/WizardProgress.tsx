/**
 * Wizard Progress Component
 *
 * Visual progress indicator showing current step and completion status.
 * Responsive design: horizontal scrollable on small screens, compact mode on mobile.
 */

import React, { useCallback, useState, useEffect } from 'react';
import { useWizard } from '../context/WizardContext';
import type { WizardProgressProps, StepStatus } from '../types';

// Breakpoints for responsive behavior
const MOBILE_BREAKPOINT = 480;
const TABLET_BREAKPOINT = 768;

/**
 * WizardProgress shows the progress through wizard steps.
 * Adapts to screen size with horizontal scroll and compact modes.
 *
 * @example
 * ```tsx
 * <WizardProgress
 *   direction="horizontal"
 *   showNumbers
 *   allowJump
 * />
 * ```
 */
export function WizardProgress({
  direction = 'horizontal',
  showNumbers = true,
  allowJump = true,
  className = '',
}: WizardProgressProps) {
  const { state, goToStep, currentStepIndex } = useWizard();
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1024
  );
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Track window resize for responsive behavior
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = windowWidth < MOBILE_BREAKPOINT;
  const isTablet = windowWidth < TABLET_BREAKPOINT;

  const handleStepClick = useCallback(async (index: number) => {
    if (!allowJump) return;

    const targetStep = state.steps[index];
    if (!targetStep) return;

    // Can only jump to visited/completed steps
    if (targetStep.visited || index < currentStepIndex) {
      await goToStep(index);
    }
  }, [allowJump, state.steps, currentStepIndex, goToStep]);

  const isHorizontal = direction === 'horizontal';

  // Mobile compact view - show current step with expand toggle
  if (isMobile && !isCollapsed) {
    const currentStep = state.steps[currentStepIndex];
    return (
      <div
        className={`wizard-progress wizard-progress--mobile ${className}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: '#f5f5f5',
          borderBottom: '1px solid #e0e0e0',
          minHeight: '48px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: '#1976d2',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            {currentStepIndex + 1}
          </div>
          <span style={{ fontSize: '14px', fontWeight: 500 }}>
            {currentStep?.step.name}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed(true)}
          style={{
            background: 'none',
            border: '1px solid #ddd',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '12px',
            color: '#666',
            cursor: 'pointer',
          }}
          aria-label="Show all steps"
        >
          {currentStepIndex + 1}/{state.steps.length} ▼
        </button>
      </div>
    );
  }

  // Mobile expanded view - vertical list
  if (isMobile && isCollapsed) {
    return (
      <div
        className={`wizard-progress wizard-progress--mobile-expanded ${className}`}
        style={{
          backgroundColor: '#f5f5f5',
          borderBottom: '1px solid #e0e0e0',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid #e0e0e0',
          }}
        >
          <span style={{ fontSize: '14px', fontWeight: 500 }}>All Steps</span>
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            style={{
              background: 'none',
              border: '1px solid #ddd',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '12px',
              color: '#666',
              cursor: 'pointer',
            }}
            aria-label="Collapse steps"
          >
            ▲
          </button>
        </div>
        <div style={{ padding: '8px 16px' }}>
          {state.steps.map((stepState, index) => (
            <div
              key={stepState.step.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '8px 0',
                opacity: stepState.status === 'pending' && index !== currentStepIndex ? 0.5 : 1,
              }}
            >
              <StepIndicator
                index={index}
                stepState={stepState}
                isCurrent={index === currentStepIndex}
                isClickable={allowJump && (stepState.visited || index < currentStepIndex)}
                showNumber={showNumbers}
                onClick={() => {
                  handleStepClick(index);
                  setIsCollapsed(false);
                }}
                direction="horizontal"
                compact
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Tablet/desktop view - horizontal with scroll if needed
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: isHorizontal ? 'row' : 'column',
    alignItems: isHorizontal ? 'center' : 'flex-start',
    justifyContent: isHorizontal ? 'space-between' : 'flex-start',
    padding: isTablet ? '12px' : '16px',
    gap: isHorizontal ? '4px' : '8px',
    backgroundColor: '#f5f5f5',
    borderBottom: '1px solid #e0e0e0',
    overflowX: isHorizontal ? 'auto' : 'visible',
    overflowY: 'visible',
    minWidth: 0, // Allow flex shrinking
    WebkitOverflowScrolling: 'touch', // Smooth scrolling on iOS
  };

  return (
    <div className={`wizard-progress ${className}`} style={containerStyle}>
      {state.steps.map((stepState, index) => (
        <React.Fragment key={stepState.step.id}>
          <StepIndicator
            index={index}
            stepState={stepState}
            isCurrent={index === currentStepIndex}
            isClickable={allowJump && (stepState.visited || index < currentStepIndex)}
            showNumber={showNumbers}
            onClick={() => handleStepClick(index)}
            direction={direction}
            compact={isTablet}
          />
          {index < state.steps.length - 1 && (
            <StepConnector
              isCompleted={stepState.status === 'completed'}
              direction={direction}
              compact={isTablet}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Individual step indicator
 */
interface StepIndicatorProps {
  index: number;
  stepState: { step: { name: string; icon?: string }; status: StepStatus; visited: boolean };
  isCurrent: boolean;
  isClickable: boolean;
  showNumber: boolean;
  onClick: () => void;
  direction: 'horizontal' | 'vertical';
  compact?: boolean;
}

function StepIndicator({
  index,
  stepState,
  isCurrent,
  isClickable,
  showNumber,
  onClick,
  direction,
  compact = false,
}: StepIndicatorProps) {
  const { step, status } = stepState;
  const isHorizontal = direction === 'horizontal';

  const getStatusColor = () => {
    switch (status) {
      case 'completed':
        return '#4caf50';
      case 'error':
        return '#f44336';
      case 'current':
        return '#1976d2';
      case 'skipped':
        return '#9e9e9e';
      default:
        return '#bdbdbd';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'completed':
        return <i className="fa-solid fa-check" />;
      case 'error':
        return <i className="fa-solid fa-exclamation" />;
      case 'skipped':
        return <i className="fa-solid fa-minus" />;
      default:
        if (showNumber) return String(index + 1);
        if (step.icon) return <i className={`fa-solid fa-${step.icon}`} />;
        return '';
    }
  };

  const circleSize = compact ? 24 : 32;
  const fontSize = compact ? 11 : 14;

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: isHorizontal ? 'column' : 'row',
    alignItems: 'center',
    gap: compact ? '4px' : '8px',
    cursor: isClickable ? 'pointer' : 'default',
    opacity: status === 'pending' && !isCurrent ? 0.6 : 1,
    transition: 'opacity 0.2s',
    flexShrink: 0, // Prevent shrinking in scrollable container
    minWidth: compact ? 'auto' : undefined,
  };

  const circleStyle: React.CSSProperties = {
    width: `${circleSize}px`,
    height: `${circleSize}px`,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: `${fontSize}px`,
    fontWeight: 600,
    backgroundColor: isCurrent ? getStatusColor() : 'white',
    color: isCurrent ? 'white' : getStatusColor(),
    border: `2px solid ${getStatusColor()}`,
    transition: 'all 0.2s',
    flexShrink: 0,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: compact ? '10px' : '12px',
    fontWeight: isCurrent ? 600 : 400,
    color: isCurrent ? '#333' : '#666',
    whiteSpace: 'nowrap',
    maxWidth: compact ? '60px' : isHorizontal ? '80px' : 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  return (
    <div
      style={containerStyle}
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
          onClick();
        }
      }}
      aria-current={isCurrent ? 'step' : undefined}
    >
      <div style={circleStyle}>{getStatusIcon()}</div>
      <span style={labelStyle}>{step.name}</span>
    </div>
  );
}

/**
 * Connector line between steps
 */
interface StepConnectorProps {
  isCompleted: boolean;
  direction: 'horizontal' | 'vertical';
  compact?: boolean;
}

function StepConnector({ isCompleted, direction, compact = false }: StepConnectorProps) {
  const isHorizontal = direction === 'horizontal';

  const style: React.CSSProperties = {
    flex: isHorizontal ? 1 : 'none',
    minWidth: isHorizontal ? (compact ? '12px' : '20px') : undefined,
    height: isHorizontal ? '2px' : (compact ? '12px' : '20px'),
    width: isHorizontal ? 'auto' : '2px',
    marginLeft: isHorizontal ? '0' : (compact ? '11px' : '15px'),
    backgroundColor: isCompleted ? '#4caf50' : '#e0e0e0',
    transition: 'background-color 0.2s',
    flexShrink: 0,
  };

  return <div style={style} />;
}
