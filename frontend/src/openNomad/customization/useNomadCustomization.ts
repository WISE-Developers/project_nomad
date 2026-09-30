/**
 * Nomad Customization hooks — access theme, labels, features, actions, and
 * slots from the nearest NomadProvider (or defaults when there isn't one).
 *
 * Split out of NomadProvider.tsx so that file exports only the component
 * (react-refresh/only-export-components).
 *
 * @module openNomad/customization/useNomadCustomization
 */

import { useContext } from 'react';

import type {
  NomadFeatures,
  NomadAction,
  ActionPlacement,
  ResolvedNomadLabels,
} from './types.js';

import { DEFAULT_THEME, DEFAULT_LABELS, DEFAULT_FEATURES } from './defaults.js';

import {
  NomadCustomizationContext,
  type NomadCustomizationContextValue,
  type ThemeStyleAccessor,
} from './NomadCustomizationContext.js';

// =============================================================================
// Default Context Value
// =============================================================================

/**
 * Creates a default context value using DEFAULT_* constants.
 */
function createDefaultContextValue(): NomadCustomizationContextValue {
  return {
    theme: DEFAULT_THEME as ThemeStyleAccessor,
    labels: DEFAULT_LABELS,
    features: DEFAULT_FEATURES,
    actions: [],
    slots: {},
    getActionsForPlacement: () => [],
    getSlot: () => undefined,
    isFeatureEnabled: () => true,
    getThemeStyles: () => {
      const styles: Record<string, string> = {};
      for (const [key, value] of Object.entries(DEFAULT_THEME)) {
        if (value !== undefined) {
          styles[key] = value;
        }
      }
      return styles;
    },
  };
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Access the customization context.
 *
 * Throws if used outside of a NomadProvider.
 *
 * @returns The customization context value
 * @throws Error if used outside NomadProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { labels, theme, isFeatureEnabled } = useNomadCustomization();
 *
 *   if (!isFeatureEnabled('export')) {
 *     return null;
 *   }
 *
 *   return <button>{labels.buttons.export}</button>;
 * }
 * ```
 */
export function useNomadCustomization(): NomadCustomizationContextValue {
  const context = useContext(NomadCustomizationContext);

  if (!context) {
    throw new Error(
      'useNomadCustomization must be used within a NomadProvider. ' +
      'Wrap your component tree with <NomadProvider config={...}>.'
    );
  }

  return context;
}

/**
 * Access the customization context with fallback to defaults.
 *
 * Unlike useNomadCustomization(), this hook doesn't throw if used outside
 * a provider - it returns default values instead. Useful for components
 * that can work with or without customization.
 *
 * @returns The customization context value, or defaults if no provider
 *
 * @example
 * ```tsx
 * function FlexibleComponent() {
 *   const { labels, theme } = useNomadCustomizationOptional();
 *   // Works whether inside NomadProvider or not
 *   return <span style={{ color: theme['--nomad-primary'] }}>{labels.title}</span>;
 * }
 * ```
 */
export function useNomadCustomizationOptional(): NomadCustomizationContextValue {
  const context = useContext(NomadCustomizationContext);

  if (context) {
    return context;
  }

  // Return defaults when no provider is present
  return createDefaultContextValue();
}

// =============================================================================
// Specialized Hooks
// =============================================================================

/**
 * Access only theme values.
 *
 * @returns Theme object with all CSS custom properties
 */
export function useNomadTheme(): ThemeStyleAccessor {
  const { theme } = useNomadCustomizationOptional();
  return theme;
}

/**
 * Access only labels.
 *
 * @returns Labels object with all text content
 */
export function useNomadLabels(): ResolvedNomadLabels {
  const { labels } = useNomadCustomizationOptional();
  return labels;
}

/**
 * Access only features.
 *
 * @returns Features object with all flags
 */
export function useNomadFeatures(): Required<NomadFeatures> {
  const { features } = useNomadCustomizationOptional();
  return features;
}

/**
 * Check if a specific feature is enabled.
 *
 * @param feature - The feature to check
 * @returns true if the feature is enabled
 */
export function useIsFeatureEnabled(feature: keyof NomadFeatures): boolean {
  const { features } = useNomadCustomizationOptional();
  return features[feature] ?? true;
}

/**
 * Get actions for a specific placement.
 *
 * @param placement - The placement to filter by
 * @returns Array of actions for that placement
 */
export function useActionsForPlacement(placement: ActionPlacement): NomadAction[] {
  const { getActionsForPlacement } = useNomadCustomizationOptional();
  return getActionsForPlacement(placement);
}
