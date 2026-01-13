/**
 * White-Label Customization Types
 *
 * Type definitions for agency customization of the NomadDashboard component.
 * Enables theming, label overrides, custom actions, component slots, and feature flags.
 *
 * @module openNomad/customization/types
 */

import type { ReactNode, CSSProperties } from 'react';

// =============================================================================
// Theme Types
// =============================================================================

/**
 * CSS custom properties for theming.
 *
 * All properties use the `--nomad-*` prefix to avoid conflicts with
 * agency stylesheets. Values are applied as CSS custom properties.
 *
 * @example
 * ```tsx
 * const theme: NomadTheme = {
 *   '--nomad-primary': '#1976d2',
 *   '--nomad-font-family': '"Inter", sans-serif',
 *   '--nomad-border-radius': '8px',
 * };
 * ```
 */
export interface NomadTheme {
  // Colors
  /** Primary brand color */
  '--nomad-primary'?: string;
  /** Primary color - lighter variant (hover states) */
  '--nomad-primary-light'?: string;
  /** Primary color - darker variant (active states) */
  '--nomad-primary-dark'?: string;
  /** Secondary/accent color */
  '--nomad-secondary'?: string;
  /** Error/danger color */
  '--nomad-error'?: string;
  /** Warning color */
  '--nomad-warning'?: string;
  /** Success color */
  '--nomad-success'?: string;
  /** Informational color */
  '--nomad-info'?: string;

  // Backgrounds
  /** Main background color */
  '--nomad-background'?: string;
  /** Surface/card background */
  '--nomad-surface'?: string;
  /** Header/toolbar background */
  '--nomad-header-bg'?: string;

  // Text
  /** Primary text color */
  '--nomad-text-primary'?: string;
  /** Secondary/muted text color */
  '--nomad-text-secondary'?: string;
  /** Disabled text color */
  '--nomad-text-disabled'?: string;

  // Borders
  /** Default border color */
  '--nomad-border-color'?: string;
  /** Border radius for cards/panels */
  '--nomad-border-radius'?: string;
  /** Border radius for buttons */
  '--nomad-border-radius-sm'?: string;

  // Typography
  /** Primary font family */
  '--nomad-font-family'?: string;
  /** Monospace font family (for code/IDs) */
  '--nomad-font-family-mono'?: string;
  /** Base font size */
  '--nomad-font-size-base'?: string;
  /** Small font size */
  '--nomad-font-size-sm'?: string;
  /** Large font size */
  '--nomad-font-size-lg'?: string;

  // Spacing
  /** Base spacing unit */
  '--nomad-spacing-unit'?: string;
  /** Small spacing (0.5x) */
  '--nomad-spacing-sm'?: string;
  /** Medium spacing (1x) */
  '--nomad-spacing-md'?: string;
  /** Large spacing (2x) */
  '--nomad-spacing-lg'?: string;

  // Shadows
  /** Card/panel shadow */
  '--nomad-shadow'?: string;
  /** Elevated element shadow */
  '--nomad-shadow-lg'?: string;

  // Allow custom properties beyond the defined set
  [key: `--nomad-${string}`]: string | undefined;
}

// =============================================================================
// Label Types
// =============================================================================

/**
 * Tab labels for the dashboard navigation.
 */
export interface TabLabels {
  /** Label for the models tab */
  models?: string;
  /** Label for the drafts tab */
  drafts?: string;
  /** Label for the active jobs tab */
  jobs?: string;
}

/**
 * Button labels throughout the dashboard.
 */
export interface ButtonLabels {
  /** New model button */
  newModel?: string;
  /** View results button */
  viewResults?: string;
  /** Add to map button */
  addToMap?: string;
  /** Delete button */
  delete?: string;
  /** Cancel button */
  cancel?: string;
  /** Close button */
  close?: string;
  /** Resume draft button */
  resume?: string;
  /** Export button */
  export?: string;
}

/**
 * Tooltip and aria-label text.
 */
export interface TooltipLabels {
  /** Close dashboard tooltip */
  closeDashboard?: string;
  /** Drag to move tooltip */
  dragToMove?: string;
  /** Delete model tooltip */
  deleteModel?: string;
  /** View on map tooltip */
  viewOnMap?: string;
}

/**
 * Placeholder text for inputs.
 */
export interface PlaceholderLabels {
  /** Search models placeholder */
  searchModels?: string;
  /** Model name input placeholder */
  modelName?: string;
}

/**
 * Status labels for model/job states.
 */
export interface StatusLabels {
  /** Draft status */
  draft?: string;
  /** Queued status */
  queued?: string;
  /** Running status */
  running?: string;
  /** Completed status */
  completed?: string;
  /** Failed status */
  failed?: string;
}

/**
 * Empty state messages.
 */
export interface EmptyStateLabels {
  /** No models message */
  noModels?: string;
  /** No drafts message */
  noDrafts?: string;
  /** No active jobs message */
  noJobs?: string;
}

/**
 * All customizable labels in the dashboard.
 *
 * Supports i18n and agency branding of all text content.
 * Undefined values fall back to defaults.
 *
 * @example
 * ```tsx
 * const labels: NomadLabels = {
 *   title: 'Agency Fire Modeling',
 *   tabs: {
 *     models: 'Simulations',
 *     drafts: 'In Progress',
 *     jobs: 'Running',
 *   },
 *   buttons: {
 *     newModel: 'New Simulation',
 *   },
 * };
 * ```
 */
export interface NomadLabels {
  /** Dashboard title */
  title?: string;
  /** Tab labels */
  tabs?: TabLabels;
  /** Button labels */
  buttons?: ButtonLabels;
  /** Tooltip labels */
  tooltips?: TooltipLabels;
  /** Placeholder labels */
  placeholders?: PlaceholderLabels;
  /** Status labels */
  statuses?: StatusLabels;
  /** Empty state messages */
  emptyStates?: EmptyStateLabels;
}

// =============================================================================
// Resolved Label Types (all properties required)
// =============================================================================

/**
 * Fully resolved labels with all properties required.
 * Used internally after merging with defaults.
 */
export interface ResolvedNomadLabels {
  title: string;
  tabs: Required<TabLabels>;
  buttons: Required<ButtonLabels>;
  tooltips: Required<TooltipLabels>;
  placeholders: Required<PlaceholderLabels>;
  statuses: Required<StatusLabels>;
  emptyStates: Required<EmptyStateLabels>;
}

// =============================================================================
// Action Types
// =============================================================================

/**
 * Placement locations for custom actions.
 */
export type ActionPlacement =
  | 'toolbar'      // Main toolbar next to tabs
  | 'header'       // Header area (right side)
  | 'sidebar'      // Sidebar (if present)
  | 'results-panel' // Results/detail panel footer
  | 'map-overlay';  // Floating over map area

/**
 * Custom action button definition.
 *
 * Actions allow agencies to add custom buttons with their own handlers.
 *
 * @example
 * ```tsx
 * const exportAction: NomadAction = {
 *   id: 'agency-export',
 *   label: 'Export to Agency System',
 *   icon: <ExportIcon />,
 *   placement: 'toolbar',
 *   onClick: () => exportToAgencySystem(),
 *   disabled: false,
 * };
 * ```
 */
export interface NomadAction {
  /** Unique identifier for the action */
  id: string;
  /** Display label */
  label: string;
  /** Optional icon (ReactNode) */
  icon?: ReactNode;
  /** Where to render the action */
  placement: ActionPlacement;
  /** Click handler */
  onClick: () => void;
  /** Whether the action is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Custom inline styles */
  style?: CSSProperties;
  /** Tooltip text */
  tooltip?: string;
  /** ARIA label for accessibility */
  ariaLabel?: string;
}

// =============================================================================
// Slot Types
// =============================================================================

/**
 * Render prop function type for slots.
 *
 * Receives default content as a parameter, allowing agencies to:
 * - Render just their content: `() => <Custom />`
 * - Prepend to defaults: `(defaults) => <><Custom />{defaults}</>`
 * - Append to defaults: `(defaults) => <>{defaults}<Custom /></>`
 * - Replace entirely: `() => <Replacement />`
 */
export type SlotRenderFn = (defaultContent: ReactNode) => ReactNode;

/**
 * Available slot locations for component extension.
 *
 * @example
 * ```tsx
 * const slots: NomadSlots = {
 *   // Add agency tools after default toolbar
 *   toolbar: (defaults) => <>{defaults}<AgencyTools /></>,
 *
 *   // Replace header entirely
 *   header: () => <AgencyHeader />,
 *
 *   // Prepend logo to sidebar
 *   sidebar: (defaults) => <><AgencyLogo />{defaults}</>,
 * };
 * ```
 */
export interface NomadSlots {
  /** Header area slot */
  header?: SlotRenderFn;
  /** Toolbar/tab area slot */
  toolbar?: SlotRenderFn;
  /** Sidebar slot (embedded mode) */
  sidebar?: SlotRenderFn;
  /** Model list panel slot */
  modelListPanel?: SlotRenderFn;
  /** Drafts panel slot */
  draftsPanel?: SlotRenderFn;
  /** Jobs panel slot */
  jobsPanel?: SlotRenderFn;
  /** Results panel slot */
  resultsPanel?: SlotRenderFn;
  /** Footer slot */
  footer?: SlotRenderFn;
}

// =============================================================================
// Feature Flag Types
// =============================================================================

/**
 * Feature flags to show/hide dashboard capabilities.
 *
 * Allows agencies to disable features they don't need or aren't licensed for.
 *
 * @example
 * ```tsx
 * const features: NomadFeatures = {
 *   export: true,       // Allow export
 *   compare: false,     // Hide comparison feature
 *   drafts: true,       // Show drafts tab
 *   jobs: false,        // Hide active jobs tab
 * };
 * ```
 */
export interface NomadFeatures {
  /** Enable model export functionality */
  export?: boolean;
  /** Enable model comparison feature */
  compare?: boolean;
  /** Show drafts tab */
  drafts?: boolean;
  /** Show active jobs tab */
  jobs?: boolean;
  /** Allow model deletion */
  delete?: boolean;
  /** Allow adding results to map */
  addToMap?: boolean;
  /** Show search/filter UI */
  search?: boolean;
  /** Show model history/versioning */
  history?: boolean;
  /** Enable notifications */
  notifications?: boolean;
}

// =============================================================================
// Combined Configuration
// =============================================================================

/**
 * Complete dashboard customization configuration.
 *
 * This is the shape of the config passed to NomadProvider or
 * individual customization props on NomadDashboard.
 *
 * @example Via NomadProvider
 * ```tsx
 * const agencyConfig: NomadConfig = {
 *   title: 'Agency Fire Modeling',
 *   theme: { '--nomad-primary': '#003366' },
 *   labels: { tabs: { models: 'Simulations' } },
 *   actions: [{ id: 'export', label: 'Export', placement: 'toolbar', onClick: handleExport }],
 *   features: { export: true, compare: false },
 * };
 *
 * <NomadProvider config={agencyConfig}>
 *   <NomadDashboard />
 * </NomadProvider>
 * ```
 *
 * @example Via props
 * ```tsx
 * <NomadDashboard
 *   title="Agency Fire Modeling"
 *   theme={{ '--nomad-primary': '#003366' }}
 *   labels={{ tabs: { models: 'Simulations' } }}
 *   features={{ export: true }}
 * />
 * ```
 */
export interface NomadConfig {
  /** Dashboard title (shortcut for labels.title) */
  title?: string;
  /** Theme CSS custom properties */
  theme?: NomadTheme;
  /** Text labels for i18n/branding */
  labels?: NomadLabels;
  /** Custom action buttons */
  actions?: NomadAction[];
  /** Component extension slots */
  slots?: NomadSlots;
  /** Feature flags */
  features?: NomadFeatures;
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Deep partial type for nested config objects.
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Props that can be passed directly to NomadDashboard.
 * Same as NomadConfig but flattened for convenience.
 */
export interface NomadCustomizationProps extends NomadConfig {
  // All properties inherited from NomadConfig
  // This type exists for clarity in component prop definitions
}
