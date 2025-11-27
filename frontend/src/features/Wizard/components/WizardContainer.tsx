/**
 * Wizard Container Component
 *
 * The main wizard wrapper that provides context and layout for wizard steps.
 */

import React from 'react';
import { WizardProvider, useWizard } from '../context/WizardContext';
import type { WizardContainerProps, WizardContextValue } from '../types';

/**
 * WizardContainer wraps wizard content with the WizardProvider.
 *
 * @example
 * ```tsx
 * <WizardContainer config={wizardConfig}>
 *   <WizardProgress />
 *   <WizardStepContent />
 *   <WizardNavigation />
 * </WizardContainer>
 * ```
 *
 * @example With render prop
 * ```tsx
 * <WizardContainer config={wizardConfig}>
 *   {(context) => (
 *     <div>
 *       <h1>Step {context.currentStepIndex + 1}</h1>
 *       {renderStep(context)}
 *     </div>
 *   )}
 * </WizardContainer>
 * ```
 */
export function WizardContainer<T extends Record<string, unknown>>({
  config,
  children,
  className = '',
  style,
}: WizardContainerProps<T>) {
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    ...style,
  };

  // Check if children is a function (render prop pattern)
  const isRenderProp = typeof children === 'function';

  return (
    <WizardProvider config={config}>
      <div className={`wizard-container ${className}`} style={containerStyle}>
        {isRenderProp ? (
          <WizardRenderPropContent
            render={children as (context: WizardContextValue<T>) => React.ReactNode}
          />
        ) : (
          children
        )}
      </div>
    </WizardProvider>
  );
}

/**
 * Helper component for render prop pattern.
 * Separated to ensure useWizard is called within WizardProvider.
 */
function WizardRenderPropContent<T extends Record<string, unknown>>({
  render,
}: {
  render: (context: WizardContextValue<T>) => React.ReactNode;
}) {
  const context = useWizard<T>();
  return <>{render(context)}</>;
}
