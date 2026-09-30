/**
 * Dashboard Context Module
 *
 * Exports the dashboard context, provider, and hooks.
 *
 * @module features/Dashboard/context
 */

export {
  DashboardProvider,
  type DashboardProviderProps,
} from './DashboardProvider.js';
export {
  useDashboard,
  useDashboardOptional,
  useDashboardState,
  useDashboardTabs,
  useDashboardView,
  useModelSelection,
  useDraftSelection,
} from './useDashboard.js';
export type {
  DashboardState,
  DashboardAction,
  DashboardTab,
  DashboardView,
  ModelSortOption,
  ModelFilterOptions,
  LoadingState,
} from './DashboardContext.js';
