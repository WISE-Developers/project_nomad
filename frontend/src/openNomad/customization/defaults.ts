/**
 * Default Configuration Values
 *
 * Provides default values for all customization options.
 * These are used as fallbacks when agencies don't specify values.
 *
 * @module openNomad/customization/defaults
 */

import type {
  NomadTheme,
  NomadLabels,
  ResolvedNomadLabels,
  NomadFeatures,
  NomadConfig,
} from './types.js';

// =============================================================================
// Default Theme
// =============================================================================

/**
 * Default theme values using CSS custom properties.
 *
 * These provide the standard Nomad look and feel.
 * All values can be overridden via the theme prop or CSS.
 */
export const DEFAULT_THEME: Required<NomadTheme> = {
  // Colors
  '--nomad-primary': '#1976d2',
  '--nomad-primary-light': '#42a5f5',
  '--nomad-primary-dark': '#1565c0',
  '--nomad-secondary': '#dc004e',
  '--nomad-error': '#f44336',
  '--nomad-warning': '#ff9800',
  '--nomad-success': '#4caf50',
  '--nomad-info': '#2196f3',

  // Backgrounds
  '--nomad-background': '#ffffff',
  '--nomad-surface': '#ffffff',
  '--nomad-header-bg': '#fafafa',

  // Text
  '--nomad-text-primary': '#333333',
  '--nomad-text-secondary': '#666666',
  '--nomad-text-disabled': '#999999',

  // Borders
  '--nomad-border-color': '#e0e0e0',
  '--nomad-border-radius': '12px',
  '--nomad-border-radius-sm': '4px',

  // Typography
  '--nomad-font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  '--nomad-font-family-mono': '"SF Mono", "Monaco", "Inconsolata", "Fira Mono", "Droid Sans Mono", monospace',
  '--nomad-font-size-base': '14px',
  '--nomad-font-size-sm': '12px',
  '--nomad-font-size-lg': '16px',

  // Spacing
  '--nomad-spacing-unit': '8px',
  '--nomad-spacing-sm': '4px',
  '--nomad-spacing-md': '8px',
  '--nomad-spacing-lg': '16px',

  // Shadows
  '--nomad-shadow': '0 4px 20px rgba(0, 0, 0, 0.15)',
  '--nomad-shadow-lg': '0 8px 32px rgba(0, 0, 0, 0.2)',
};

// =============================================================================
// Default Labels
// =============================================================================

/**
 * Default labels for all UI text.
 *
 * These provide the standard English text.
 * All values can be overridden for i18n or agency branding.
 */
export const DEFAULT_LABELS: ResolvedNomadLabels = {
  title: 'Dashboard',

  tabs: {
    models: 'Models',
    drafts: 'Drafts',
    jobs: 'Active Jobs',
  },

  buttons: {
    newModel: 'New Model',
    viewResults: 'View Results',
    addToMap: 'Add to Map',
    delete: 'Delete',
    cancel: 'Cancel',
    close: 'Close',
    resume: 'Resume',
    export: 'Export',
  },

  tooltips: {
    closeDashboard: 'Close dashboard',
    dragToMove: 'drag to move',
    deleteModel: 'Delete this model',
    viewOnMap: 'View on map',
  },

  placeholders: {
    searchModels: 'Search models...',
    modelName: 'Enter model name',
  },

  statuses: {
    draft: 'Draft',
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
  },

  emptyStates: {
    noModels: 'No models yet. Create your first model to get started.',
    noDrafts: 'No drafts. Drafts will appear here when you save model configurations.',
    noJobs: 'No active jobs. Submit a model to see job progress here.',
  },
};

// =============================================================================
// Default Features
// =============================================================================

/**
 * Default feature flags.
 *
 * All features are enabled by default.
 * Agencies can disable features they don't need.
 */
export const DEFAULT_FEATURES: Required<NomadFeatures> = {
  export: true,
  compare: true,
  drafts: true,
  jobs: true,
  delete: true,
  addToMap: true,
  search: true,
  history: true,
  notifications: true,
};

// =============================================================================
// Complete Default Config
// =============================================================================

/**
 * Complete default configuration combining all defaults.
 */
export const DEFAULT_CONFIG: Required<Omit<NomadConfig, 'actions' | 'slots'>> & {
  actions: [];
  slots: Record<string, never>;
} = {
  title: DEFAULT_LABELS.title,
  theme: DEFAULT_THEME,
  labels: DEFAULT_LABELS,
  features: DEFAULT_FEATURES,
  actions: [],
  slots: {},
};

// =============================================================================
// Merge Utilities
// =============================================================================

/**
 * Merge custom theme with defaults.
 *
 * @param custom - Custom theme values (partial)
 * @returns Complete theme with defaults applied
 */
export function mergeTheme(custom?: NomadTheme): Required<NomadTheme> {
  if (!custom) return DEFAULT_THEME;
  return { ...DEFAULT_THEME, ...custom };
}

/**
 * Merge custom labels with defaults.
 *
 * @param custom - Custom labels (partial, deeply nested)
 * @returns Complete labels with defaults applied
 */
export function mergeLabels(custom?: NomadLabels): ResolvedNomadLabels {
  if (!custom) return DEFAULT_LABELS;

  // Deep merge each nested object
  return {
    title: custom.title ?? DEFAULT_LABELS.title,
    tabs: { ...DEFAULT_LABELS.tabs, ...custom.tabs },
    buttons: { ...DEFAULT_LABELS.buttons, ...custom.buttons },
    tooltips: { ...DEFAULT_LABELS.tooltips, ...custom.tooltips },
    placeholders: { ...DEFAULT_LABELS.placeholders, ...custom.placeholders },
    statuses: { ...DEFAULT_LABELS.statuses, ...custom.statuses },
    emptyStates: { ...DEFAULT_LABELS.emptyStates, ...custom.emptyStates },
  };
}

/**
 * Merge custom features with defaults.
 *
 * @param custom - Custom feature flags (partial)
 * @returns Complete features with defaults applied
 */
export function mergeFeatures(custom?: NomadFeatures): Required<NomadFeatures> {
  if (!custom) return DEFAULT_FEATURES;
  return { ...DEFAULT_FEATURES, ...custom };
}

/**
 * Resolved configuration type returned by mergeConfig.
 */
export interface ResolvedNomadConfig {
  title: string;
  theme: Required<NomadTheme>;
  labels: ResolvedNomadLabels;
  features: Required<NomadFeatures>;
  actions: NomadConfig['actions'];
  slots: NomadConfig['slots'];
}

/**
 * Merge complete custom config with defaults.
 *
 * @param custom - Custom configuration (partial)
 * @returns Complete configuration with defaults applied
 */
export function mergeConfig(custom?: NomadConfig): ResolvedNomadConfig {
  const title = custom?.title ?? custom?.labels?.title ?? DEFAULT_LABELS.title;
  const labels = mergeLabels(custom?.labels);

  return {
    title,
    theme: mergeTheme(custom?.theme),
    labels: { ...labels, title }, // Apply top-level title to labels.title
    features: mergeFeatures(custom?.features),
    actions: custom?.actions ?? [],
    slots: custom?.slots ?? {},
  };
}
