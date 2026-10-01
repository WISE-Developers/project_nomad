/**
 * Nomad Customization Context — the context object and its value type.
 *
 * Separate from NomadProvider.tsx so that the provider file exports nothing
 * but a component. Vite's fast refresh can only hot-swap a module whose
 * exports are all components; a context object alongside them forces a full
 * reload and tears down state on every edit.
 *
 * @module openNomad/customization/NomadCustomizationContext
 */

import { createContext } from 'react';

import type {
  NomadTheme,
  ResolvedNomadLabels,
  NomadFeatures,
  NomadAction,
  NomadSlots,
  ActionPlacement,
  SlotRenderFn,
} from './types.js';

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

export const NomadCustomizationContext = createContext<NomadCustomizationContextValue | null>(null);
