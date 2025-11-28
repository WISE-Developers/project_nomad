/**
 * ModelSetupWizard Component
 *
 * Main wizard wrapper for the Model Setup workflow.
 */

import React, { useCallback } from 'react';
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

const wizardStyle: React.CSSProperties = {
  position: 'absolute',
  top: '16px',
  right: '16px',
  width: '480px',
  maxHeight: 'calc(100vh - 32px)',
  backgroundColor: 'white',
  borderRadius: '12px',
  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  zIndex: 1000,
};

const headerStyle: React.CSSProperties = {
  padding: '16px 20px',
  borderBottom: '1px solid #eee',
  backgroundColor: '#f8f9fa',
};

const titleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 'bold',
  color: '#333',
  margin: 0,
};

const contentWrapperStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '0',
};

const footerStyle: React.CSSProperties = {
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
    <div style={wizardStyle}>
      <WizardContainer config={config}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={titleStyle}>🔥 New Fire Model</h2>
        </div>

        {/* Progress indicator */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #eee' }}>
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
  );
}
