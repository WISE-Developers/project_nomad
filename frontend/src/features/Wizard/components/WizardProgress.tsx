/**
 * Wizard Progress Component
 *
 * Visual progress indicator showing current step and completion status.
 */

import React, { useCallback } from 'react';
import { useWizard } from '../context/WizardContext';
import type { WizardProgressProps, StepStatus } from '../types';

/**
 * WizardProgress shows the progress through wizard steps.
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

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: isHorizontal ? 'row' : 'column',
    alignItems: isHorizontal ? 'center' : 'flex-start',
    justifyContent: isHorizontal ? 'space-between' : 'flex-start',
    padding: '16px',
    gap: isHorizontal ? '4px' : '8px',
    backgroundColor: '#f5f5f5',
    borderBottom: '1px solid #e0e0e0',
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
          />
          {index < state.steps.length - 1 && (
            <StepConnector
              isCompleted={stepState.status === 'completed'}
              direction={direction}
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
}

function StepIndicator({
  index,
  stepState,
  isCurrent,
  isClickable,
  showNumber,
  onClick,
  direction,
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

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: isHorizontal ? 'column' : 'row',
    alignItems: 'center',
    gap: '8px',
    cursor: isClickable ? 'pointer' : 'default',
    opacity: status === 'pending' && !isCurrent ? 0.6 : 1,
    transition: 'opacity 0.2s',
  };

  const circleStyle: React.CSSProperties = {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 600,
    backgroundColor: isCurrent ? getStatusColor() : 'white',
    color: isCurrent ? 'white' : getStatusColor(),
    border: `2px solid ${getStatusColor()}`,
    transition: 'all 0.2s',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: isCurrent ? 600 : 400,
    color: isCurrent ? '#333' : '#666',
    whiteSpace: 'nowrap',
    maxWidth: isHorizontal ? '80px' : 'none',
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
}

function StepConnector({ isCompleted, direction }: StepConnectorProps) {
  const isHorizontal = direction === 'horizontal';

  const style: React.CSSProperties = {
    flex: isHorizontal ? 1 : 'none',
    height: isHorizontal ? '2px' : '20px',
    width: isHorizontal ? 'auto' : '2px',
    marginLeft: isHorizontal ? '0' : '15px',
    backgroundColor: isCompleted ? '#4caf50' : '#e0e0e0',
    transition: 'background-color 0.2s',
  };

  return <div style={style} />;
}
