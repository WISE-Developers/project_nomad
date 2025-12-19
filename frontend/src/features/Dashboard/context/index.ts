/**
 * Dashboard Context Module
 *
 * Exports the dashboard context, provider, and hooks.
 *
 * @module features/Dashboard/context
 */

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
} from './DashboardContext.js';
