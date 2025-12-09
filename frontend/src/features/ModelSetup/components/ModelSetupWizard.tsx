/**
 * ModelSetupWizard Component
 *
 * Main wizard wrapper for the Model Setup workflow.
 * Draggable and resizable panel.
 */

import React, { useCallback, useState } from 'react';
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

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 600;
const MIN_WIDTH = 380;
const MIN_HEIGHT = 400;

const wizardInnerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  backgroundColor: 'white',
  borderRadius: '12px',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '16px 20px',
  borderBottom: '1px solid #eee',
  backgroundColor: '#f8f9fa',
  cursor: 'move',
  userSelect: 'none',
  borderRadius: '12px 12px 0 0',
};

const titleStyle: React.CSSProperties = {
  fontSize: '18px',
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
};

const contentWrapperStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0, // Required for flex child to respect overflow
  overflow: 'auto',
  padding: '0',
};

const footerStyle: React.CSSProperties = {
  flexShrink: 0, // Never shrink - always visible
  borderTop: '1px solid #eee',
  backgroundColor: '#f8f9fa',
};

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
  // Calculate initial position (center of screen)
  const [initialX] = useState(() => (window.innerWidth - DEFAULT_WIDTH) / 2);
  const [initialY] = useState(() => (window.innerHeight - DEFAULT_HEIGHT) / 2);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

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

  return (
    <Rnd
      default={{
        x: initialX,
        y: initialY,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
      }}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      maxWidth={800}
      maxHeight={window.innerHeight - 32}
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
      <div style={{ ...wizardInnerStyle, width: size.width, height: size.height }}>
        <WizardContainer config={config}>
          {/* Header - Drag Handle */}
          <div style={headerStyle} className="wizard-drag-handle">
            <h2 style={titleStyle}>
              <span><i className="fa-solid fa-fire" style={{ marginRight: '8px' }} />New Fire Model</span>
              <span style={dragHintStyle}>drag to move</span>
            </h2>
          </div>

          {/* Progress indicator */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee', flexShrink: 0 }}>
            <WizardProgress
              direction="horizontal"
              showNumbers={true}
              allowJump={false}
            />
          </div>

          {/* Step content */}
          <div style={contentWrapperStyle}>
            <WizardStepContent showTitle={true} showDescription={true} showErrors={true}>
              <StepRouter />
            </WizardStepContent>
          </div>

          {/* Navigation */}
          <div style={footerStyle}>
            <WizardNavigation
              backLabel="Back"
              nextLabel="Continue"
              finishLabel="Start Model"
              cancelLabel="Cancel"
              showCancel={true}
            />
          </div>
        </WizardContainer>
      </div>
    </Rnd>
  );
}
