/**
 * White-Label Customization Module
 *
 * Provides theming, labels, actions, slots, and feature flags for
 * agency customization of the NomadDashboard component.
 *
 * @module openNomad/customization
 *
 * @example Basic Usage
 * ```tsx
 * import {
 *   NomadProvider,
 *   useNomadCustomization,
 *   type NomadConfig,
 * } from '@/openNomad/customization';
 *
 * const agencyConfig: NomadConfig = {
 *   title: 'Agency Fire Modeling',
 *   theme: { '--nomad-primary': '#003366' },
 *   labels: { tabs: { models: 'Simulations' } },
 *   features: { compare: false },
 * };
 *
 * function App() {
 *   return (
 *     <NomadProvider config={agencyConfig}>
 *       <NomadDashboard />
 *     </NomadProvider>
 *   );
 * }
 * ```
 */

// Types
export type {
  NomadTheme,
  NomadLabels,
  ResolvedNomadLabels,
  TabLabels,
  ButtonLabels,
  TooltipLabels,
  PlaceholderLabels,
  StatusLabels,
  EmptyStateLabels,
  NomadAction,
  ActionPlacement,
  NomadSlots,
  SlotRenderFn,
  NomadFeatures,
  NomadConfig,
  NomadCustomizationProps,
  DeepPartial,
} from './types.js';

// Defaults
export {
  DEFAULT_THEME,
  DEFAULT_LABELS,
  DEFAULT_FEATURES,
  DEFAULT_CONFIG,
  mergeTheme,
  mergeLabels,
  mergeFeatures,
  mergeConfig,
  type ResolvedNomadConfig,
} from './defaults.js';

// Context and Provider
export {
  NomadProvider,
  useNomadCustomization,
  useNomadCustomizationOptional,
  useNomadTheme,
  useNomadLabels,
  useNomadFeatures,
  useIsFeatureEnabled,
  useActionsForPlacement,
  type NomadProviderProps,
  type NomadCustomizationContextValue,
  type ThemeStyleAccessor,
} from './NomadCustomizationContext.js';

// Components
export {
  ThemedContainer,
  ActionButton,
  ActionsContainer,
  SlotRenderer,
  FeatureGate,
  ToolbarWithActions,
  HeaderWithActions,
  type ThemedContainerProps,
  type ActionButtonProps,
  type ActionsContainerProps,
  type SlotRendererProps,
  type FeatureGateProps,
  type ToolbarWithActionsProps,
  type HeaderWithActionsProps,
} from './components.js';
