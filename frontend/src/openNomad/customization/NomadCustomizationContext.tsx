/**
 * Nomad Customization Context
 *
 * Provides white-label customization to all Nomad components.
 * Supports theming, labels, actions, slots, and feature flags.
 *
 * @module openNomad/customization/NomadCustomizationContext
 */

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

import type {
  NomadConfig,
  NomadTheme,
  NomadLabels,
  ResolvedNomadLabels,
  NomadFeatures,
  NomadAction,
  NomadSlots,
  ActionPlacement,
  SlotRenderFn,
} from './types.js';

import {
  DEFAULT_THEME,
  DEFAULT_LABELS,
  DEFAULT_FEATURES,
  mergeConfig,
} from './defaults.js';

// =============================================================================
// Theme Style Type
// =============================================================================

/**
 * Type for accessing theme values by key.
 * This provides type safety when accessing theme properties.
 */
export type ThemeStyleAccessor = {
  [K in keyof Required<NomadTheme>]: string;
};

// =============================================================================
// Context Value Type
// =============================================================================

/**
 * Resolved customization context value.
 *
 * All optional values from NomadConfig are resolved to required values
 * by applying defaults.
 */
export interface NomadCustomizationContextValue {
  /** Resolved theme with defaults applied */
  theme: ThemeStyleAccessor;
  /** Resolved labels with defaults applied */
  labels: ResolvedNomadLabels;
  /** Resolved features with defaults applied */
  features: Required<NomadFeatures>;
  /** Custom actions (empty array if none) */
  actions: NomadAction[];
  /** Component slots (empty object if none) */
  slots: NomadSlots;

  // Convenience methods
  /** Get actions for a specific placement */
  getActionsForPlacement: (placement: ActionPlacement) => NomadAction[];
  /** Get slot render function if defined */
  getSlot: (name: keyof NomadSlots) => SlotRenderFn | undefined;
  /** Check if a feature is enabled */
  isFeatureEnabled: (feature: keyof NomadFeatures) => boolean;
  /** Get theme as a Record for use in inline styles */
  getThemeStyles: () => Record<string, string>;
}

// =============================================================================
// Context Creation
// =============================================================================

const NomadCustomizationContext = createContext<NomadCustomizationContextValue | null>(null);

// =============================================================================
// Provider Props
// =============================================================================

/**
 * Props for NomadProvider.
 *
 * Either pass a complete config object, or individual customization props.
 * Individual props are merged with the config object if both are provided.
 */
export interface NomadProviderProps {
  /**
   * Complete customization configuration.
   * Use this for agency-wide configs stored in a central location.
   */
  config?: NomadConfig;

  /**
   * Dashboard title override.
   * Shortcut for config.labels.title
   */
  title?: string;

  /**
   * Theme CSS variables override.
   */
  theme?: NomadTheme;

  /**
   * Labels override.
   */
  labels?: NomadLabels;

  /**
   * Custom action buttons.
   */
  actions?: NomadAction[];

  /**
   * Component slots for extension.
   */
  slots?: NomadSlots;

  /**
   * Feature flags.
   */
  features?: NomadFeatures;

  /**
   * Child components.
   */
  children: ReactNode;
}

// =============================================================================
// Provider Component
// =============================================================================

/**
 * Provides customization context to all Nomad components.
 *
 * Wrap your application or the NomadDashboard component with this provider
 * to enable white-label customization.
 *
 * @example Basic usage with config object
 * ```tsx
 * const agencyConfig: NomadConfig = {
 *   title: 'Agency Fire Modeling',
 *   theme: { '--nomad-primary': '#003366' },
 *   labels: { tabs: { models: 'Simulations' } },
 *   features: { compare: false },
 * };
 *
 * <NomadProvider config={agencyConfig}>
 *   <NomadDashboard />
 * </NomadProvider>
 * ```
 *
 * @example Usage with individual props
 * ```tsx
 * <NomadProvider
 *   title="Agency Fire Modeling"
 *   theme={{ '--nomad-primary': '#003366' }}
 *   features={{ export: true, compare: false }}
 * >
 *   <NomadDashboard />
 * </NomadProvider>
 * ```
 *
 * @example Combined with OpenNomadProvider
 * ```tsx
 * <OpenNomadProvider adapter={adapter}>
 *   <NomadProvider config={agencyConfig}>
 *     <NomadDashboard />
 *   </NomadProvider>
 * </OpenNomadProvider>
 * ```
 */
export function NomadProvider({
  config,
  title,
  theme,
  labels,
  actions,
  slots,
  features,
  children,
}: NomadProviderProps) {
  // Merge individual props with config, preferring individual props
  const mergedConfig = useMemo<NomadConfig>(() => {
    const base = config ?? {};

    return {
      title: title ?? base.title,
      theme: theme ? { ...base.theme, ...theme } : base.theme,
      labels: labels ? { ...base.labels, ...labels } : base.labels,
      actions: actions ?? base.actions,
      slots: slots ? { ...base.slots, ...slots } : base.slots,
      features: features ? { ...base.features, ...features } : base.features,
    };
  }, [config, title, theme, labels, actions, slots, features]);

  // Resolve config with defaults
  const resolved = useMemo(() => mergeConfig(mergedConfig), [mergedConfig]);

  // Create context value with convenience methods
  const contextValue = useMemo<NomadCustomizationContextValue>(() => ({
    theme: resolved.theme as ThemeStyleAccessor,
    labels: resolved.labels,
    features: resolved.features,
    actions: resolved.actions ?? [],
    slots: resolved.slots ?? {},

    getActionsForPlacement(placement: ActionPlacement): NomadAction[] {
      return (resolved.actions ?? []).filter(
        (action) => action.placement === placement
      );
    },

    getSlot(name: keyof NomadSlots): SlotRenderFn | undefined {
      return resolved.slots?.[name];
    },

    isFeatureEnabled(feature: keyof NomadFeatures): boolean {
      return resolved.features[feature] ?? true;
    },

    getThemeStyles(): Record<string, string> {
      // Convert theme object to CSS custom properties
      const styles: Record<string, string> = {};
      for (const [key, value] of Object.entries(resolved.theme)) {
        if (value !== undefined) {
          styles[key] = value;
        }
      }
      return styles;
    },
  }), [resolved]);

  return (
    <NomadCustomizationContext.Provider value={contextValue}>
      {children}
    </NomadCustomizationContext.Provider>
  );
}

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
