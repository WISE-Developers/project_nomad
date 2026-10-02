/**
 * Nomad Customization Context
 *
 * Provides white-label customization to all Nomad components.
 * Supports theming, labels, actions, slots, and feature flags.
 *
 * @module openNomad/customization/NomadCustomizationContext
 */

import {
  useMemo,
  type ReactNode,
} from 'react';

import type {
  NomadConfig,
  NomadTheme,
  NomadLabels,
  NomadAction,
  NomadSlots,
  ActionPlacement,
  NomadFeatures,
  SlotRenderFn,
} from './types.js';

import { mergeConfig } from './defaults.js';

import {
  NomadCustomizationContext,
  type NomadCustomizationContextValue,
  type ThemeStyleAccessor,
} from './NomadCustomizationContext.js';

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
