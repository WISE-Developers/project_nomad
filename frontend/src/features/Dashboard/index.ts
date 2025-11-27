/**
 * Dashboard Feature Module
 *
 * Provides dashboard components for managing draft models.
 */

// Components
export { DraftsDashboard } from './components/DraftsDashboard';
export { DraftCard } from './components/DraftCard';

// Hooks
export { useDrafts } from './hooks/useDrafts';

// Types
export type {
  DraftSummary,
  DraftType,
  DraftSortOption,
  DraftFilterOptions,
  DashboardState,
} from './types/draft';
