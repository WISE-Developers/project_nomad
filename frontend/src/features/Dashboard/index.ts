/**
 * Dashboard Feature Module
 *
 * Provides dashboard components for managing models, drafts, and jobs.
 * Uses the openNomad API for all backend communication.
 *
 * @module features/Dashboard
 */

// =============================================================================
// Components
// =============================================================================

// Main container
export { DashboardContainer, type DashboardContainerProps, type DashboardMode } from './components/DashboardContainer.js';

// Model components
export { ModelList, type ModelListProps } from './components/ModelList.js';
export { ModelCard, type ModelCardProps } from './components/ModelCard.js';

// Draft components
export { DraftsDashboard } from './components/DraftsDashboard.js';
export { DraftCard } from './components/DraftCard.js';

// Job components
export { StatusMonitor, type StatusMonitorProps } from './components/StatusMonitor.js';

// =============================================================================
// Context
// =============================================================================

export {
  DashboardProvider,
  useDashboard,
  useDashboardOptional,
  useDashboardState,
  useDashboardTabs,
  useModelSelection,
  useDraftSelection,
  type DashboardProviderProps,
  type DashboardState,
  type DashboardAction,
  type DashboardTab,
  type ModelSortOption,
  type ModelFilterOptions,
  type LoadingState,
} from './context/index.js';

// =============================================================================
// Hooks
// =============================================================================

export { useModels, type UseModelsOptions, type UseModelsReturn } from './hooks/useModels.js';
export { useJobs, useJobWatcher, type UseJobsOptions, type UseJobsReturn } from './hooks/useJobs.js';
export { useResults, useResultViewer, type UseResultsOptions, type UseResultsReturn } from './hooks/useResults.js';
export { useDrafts } from './hooks/useDrafts.js';

// =============================================================================
// Types
// =============================================================================

export type {
  DraftSummary,
  DraftType,
  DraftSortOption,
  DraftFilterOptions,
  DashboardState as DraftDashboardState,
} from './types/draft.js';
