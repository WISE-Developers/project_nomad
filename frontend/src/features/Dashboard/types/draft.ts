/**
 * Draft Types
 *
 * Type definitions for draft models in the dashboard.
 */

/**
 * Draft model summary for display
 */
export interface DraftSummary {
  /** Unique draft ID */
  id: string;
  /** Draft name or title */
  name: string;
  /** Draft type (model-setup, review, export) */
  type: DraftType;
  /** Current step index */
  currentStep: number;
  /** Total number of steps */
  totalSteps: number;
  /** Completion percentage (0-100) */
  completionPercentage: number;
  /** When the draft was created */
  createdAt: Date;
  /** When the draft was last modified */
  updatedAt: Date;
  /** Brief description or summary */
  description?: string;
}

/**
 * Draft type for categorization
 */
export type DraftType = 'model-setup' | 'model-review' | 'model-export' | 'unknown';

/**
 * Sort options for drafts
 */
export type DraftSortOption = 'updatedAt' | 'createdAt' | 'name' | 'completion';

/**
 * Filter options for drafts
 */
export interface DraftFilterOptions {
  /** Filter by type */
  type?: DraftType;
  /** Search query */
  search?: string;
}

/**
 * Dashboard view state
 */
export interface DashboardState {
  /** All drafts */
  drafts: DraftSummary[];
  /** Currently selected draft IDs */
  selectedIds: string[];
  /** Sort order */
  sortBy: DraftSortOption;
  /** Sort direction */
  sortDirection: 'asc' | 'desc';
  /** Filter options */
  filters: DraftFilterOptions;
  /** Loading state */
  isLoading: boolean;
}
