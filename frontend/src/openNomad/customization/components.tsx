/**
 * Customization Helper Components
 *
 * Components for rendering custom actions, slots, and themed containers.
 *
 * @module openNomad/customization/components
 */

import { type ReactNode, type CSSProperties } from 'react';
import type { NomadAction, ActionPlacement, NomadSlots } from './types.js';
import { useNomadCustomizationOptional, useActionsForPlacement } from './NomadCustomizationContext.js';

// =============================================================================
// Themed Container
// =============================================================================

export interface ThemedContainerProps {
  /** Child content */
  children: ReactNode;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** HTML tag to use (default: div) */
  as?: keyof JSX.IntrinsicElements;
}

/**
 * Container that applies Nomad theme CSS variables.
 *
 * Wrap your Nomad components with this to apply theming.
 * The CSS variables cascade to all child elements.
 *
 * @example
 * ```tsx
 * <ThemedContainer>
 *   <DashboardContent />
 * </ThemedContainer>
 * ```
 */
export function ThemedContainer({
  children,
  className,
  style,
  as: Component = 'div',
}: ThemedContainerProps) {
  const { getThemeStyles } = useNomadCustomizationOptional();
  const themeStyles = getThemeStyles();

  const combinedStyles: CSSProperties = {
    ...themeStyles,
    ...style,
  };

  return (
    <Component
      className={`nomad-themed ${className ?? ''}`.trim()}
      style={combinedStyles}
    >
      {children}
    </Component>
  );
}

// =============================================================================
// Action Button
// =============================================================================

export interface ActionButtonProps {
  /** The action to render */
  action: NomadAction;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}

/**
 * Renders a single custom action button.
 *
 * @example
 * ```tsx
 * <ActionButton action={exportAction} />
 * ```
 */
export function ActionButton({ action, className, style }: ActionButtonProps) {
  const { theme } = useNomadCustomizationOptional();

  const buttonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    fontSize: theme['--nomad-font-size-base'],
    fontFamily: theme['--nomad-font-family'],
    color: theme['--nomad-text-primary'],
    backgroundColor: 'transparent',
    border: `1px solid ${theme['--nomad-border-color']}`,
    borderRadius: theme['--nomad-border-radius-sm'],
    cursor: action.disabled ? 'not-allowed' : 'pointer',
    opacity: action.disabled ? 0.5 : 1,
    transition: 'all 0.2s ease',
    ...action.style,
    ...style,
  };

  return (
    <button
      type="button"
      onClick={action.disabled ? undefined : action.onClick}
      disabled={action.disabled}
      className={`nomad-action-button ${action.className ?? ''} ${className ?? ''}`.trim()}
      style={buttonStyle}
      title={action.tooltip}
      aria-label={action.ariaLabel ?? action.label}
    >
      {action.icon && <span className="nomad-action-icon">{action.icon}</span>}
      <span className="nomad-action-label">{action.label}</span>
    </button>
  );
}

// =============================================================================
// Actions Container
// =============================================================================

export interface ActionsContainerProps {
  /** Placement to render actions for */
  placement: ActionPlacement;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}

/**
 * Renders all actions for a specific placement.
 *
 * @example
 * ```tsx
 * <ActionsContainer placement="toolbar" />
 * ```
 */
export function ActionsContainer({ placement, className, style }: ActionsContainerProps) {
  const actions = useActionsForPlacement(placement);

  if (actions.length === 0) {
    return null;
  }

  const containerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    ...style,
  };

  return (
    <div
      className={`nomad-actions nomad-actions-${placement} ${className ?? ''}`.trim()}
      style={containerStyle}
    >
      {actions.map((action) => (
        <ActionButton key={action.id} action={action} />
      ))}
    </div>
  );
}

// =============================================================================
// Slot Renderer
// =============================================================================

export interface SlotRendererProps {
  /** Slot name to render */
  name: keyof NomadSlots;
  /** Default content to pass to slot function */
  defaultContent?: ReactNode;
  /** Children as fallback if no slot defined */
  children?: ReactNode;
}

/**
 * Renders a slot with optional default content.
 *
 * If a slot function is defined, it receives the default content
 * and can wrap, replace, or augment it.
 *
 * @example
 * ```tsx
 * <SlotRenderer name="toolbar" defaultContent={<DefaultToolbar />}>
 *   <DefaultToolbar />
 * </SlotRenderer>
 * ```
 */
export function SlotRenderer({ name, defaultContent, children }: SlotRendererProps) {
  const { getSlot } = useNomadCustomizationOptional();
  const slotFn = getSlot(name);

  // Use children as default content if defaultContent not provided
  const content = defaultContent ?? children;

  if (slotFn) {
    return <>{slotFn(content)}</>;
  }

  return <>{content}</>;
}

// =============================================================================
// Feature Gate
// =============================================================================

export interface FeatureGateProps {
  /** Feature to check */
  feature: keyof import('./types.js').NomadFeatures;
  /** Content to render if feature is enabled */
  children: ReactNode;
  /** Optional fallback if feature is disabled */
  fallback?: ReactNode;
}

/**
 * Conditionally renders children based on feature flag.
 *
 * @example
 * ```tsx
 * <FeatureGate feature="export">
 *   <ExportButton />
 * </FeatureGate>
 *
 * <FeatureGate feature="compare" fallback={<span>Comparison not available</span>}>
 *   <CompareModels />
 * </FeatureGate>
 * ```
 */
export function FeatureGate({ feature, children, fallback = null }: FeatureGateProps) {
  const { isFeatureEnabled } = useNomadCustomizationOptional();

  if (isFeatureEnabled(feature)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}

// =============================================================================
// Composed Components for Common Patterns
// =============================================================================

export interface ToolbarWithActionsProps {
  /** Default toolbar content */
  children: ReactNode;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}

/**
 * Toolbar that includes custom actions from the 'toolbar' placement.
 *
 * Use this to easily add agency actions to the toolbar.
 *
 * @example
 * ```tsx
 * <ToolbarWithActions>
 *   <DefaultToolbarContent />
 * </ToolbarWithActions>
 * ```
 */
export function ToolbarWithActions({ children, className, style }: ToolbarWithActionsProps) {
  const containerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    ...style,
  };

  return (
    <SlotRenderer name="toolbar" defaultContent={children}>
      <div className={`nomad-toolbar ${className ?? ''}`.trim()} style={containerStyle}>
        {children}
        <ActionsContainer placement="toolbar" />
      </div>
    </SlotRenderer>
  );
}

export interface HeaderWithActionsProps {
  /** Default header content */
  children: ReactNode;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}

/**
 * Header that includes custom actions from the 'header' placement.
 *
 * @example
 * ```tsx
 * <HeaderWithActions>
 *   <h2>Dashboard</h2>
 * </HeaderWithActions>
 * ```
 */
export function HeaderWithActions({ children, className, style }: HeaderWithActionsProps) {
  const containerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...style,
  };

  return (
    <SlotRenderer name="header" defaultContent={children}>
      <div className={`nomad-header ${className ?? ''}`.trim()} style={containerStyle}>
        {children}
        <ActionsContainer placement="header" />
      </div>
    </SlotRenderer>
  );
}
