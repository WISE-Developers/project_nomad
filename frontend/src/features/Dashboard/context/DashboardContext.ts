/**
 * Dashboard Context — shared types, actions, and the context object.
 *
 * Separate from DashboardProvider.tsx so that the provider file exports
 * nothing but a component. Vite's fast refresh can only hot-swap a module
 * whose exports are all components; a context object (and the hooks that
 * consume it) alongside them forces a full reload and tears down state on
 * every edit.
 *
 * @module features/Dashboard/context
 */

import { createContext, type Dispatch } from 'react';
import type { Model, ModelStatus, EngineType, Job } from '../../../openNomad/api.js';
import type { DraftSummary, DraftSortOption, DraftFilterOptions } from '../types/draft.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Tab options in the dashboard
 */
export type DashboardTab = 'models' | 'drafts' | 'jobs';

/**
 * View state for internal navigation
 * - 'dashboard': Main dashboard view with tabs
 * - 'wizard': Model setup wizard
 * - 'results': Model results viewer
 */
export type DashboardView = 'dashboard' | 'wizard' | 'results';

/**
 * Sort options for models
 */
export type ModelSortOption = 'createdAt' | 'updatedAt' | 'name' | 'status';

/**
 * Filter options for models
 */
export interface ModelFilterOptions {
  /** Filter by status */
  status?: ModelStatus | ModelStatus[];
  /** Filter by engine type */
  engine?: EngineType;
  /** Search query */
  search?: string;
}

/**
 * Loading state for async sections
 */
export interface LoadingState {
  /** Whether the section is loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** When data was last fetched */
  lastFetched: number | null;
}

/**
 * Dashboard state shape
 */
export interface DashboardState {
  // === View Navigation ===
  /** Currently active view (dashboard, wizard, or results) */
  activeView: DashboardView;
  /** Draft ID being resumed in wizard (null for new model) */
  wizardDraftId: string | null;
  /** Model ID being viewed in results view */
  resultsModelId: string | null;

  // === Active Tab ===
  /** Currently active tab */
  activeTab: DashboardTab;

  // === Models (from API) ===
  /** Models fetched from backend */
  models: Model[];
  /** Loading state for models */
  modelsLoading: LoadingState;
  /** Currently selected model IDs */
  selectedModelIds: string[];
  /** Model sort field */
  modelSortBy: ModelSortOption;
  /** Model sort direction */
  modelSortDirection: 'asc' | 'desc';
  /** Model filters */
  modelFilters: ModelFilterOptions;

  // === Drafts (from localStorage) ===
  /** Draft summaries from localStorage */
  drafts: DraftSummary[];
  /** Loading state for drafts */
  draftsLoading: LoadingState;
  /** Currently selected draft IDs */
  selectedDraftIds: string[];
  /** Draft sort field */
  draftSortBy: DraftSortOption;
  /** Draft sort direction */
  draftSortDirection: 'asc' | 'desc';
  /** Draft filters */
  draftFilters: DraftFilterOptions;

  // === Active Jobs ===
  /** Jobs currently being tracked */
  activeJobs: Job[];
  /** Loading state for jobs */
  jobsLoading: LoadingState;
  /** Currently focused job ID (for detail view) */
  focusedJobId: string | null;

  // === UI State ===
  /** Whether dashboard is in compact mode */
  isCompact: boolean;
  /** Whether bulk actions are enabled */
  bulkSelectMode: boolean;
}

// =============================================================================
// Actions
// =============================================================================

export type DashboardAction =
  // View navigation
  | { type: 'SHOW_DASHBOARD' }
  | { type: 'SHOW_WIZARD'; draftId?: string }
  | { type: 'SHOW_RESULTS'; modelId: string }

  // Tab navigation
  | { type: 'SET_ACTIVE_TAB'; tab: DashboardTab }

  // Models
  | { type: 'SET_MODELS'; models: Model[] }
  | { type: 'SET_MODELS_LOADING'; loading: Partial<LoadingState> }
  | { type: 'SELECT_MODEL'; id: string }
  | { type: 'DESELECT_MODEL'; id: string }
  | { type: 'TOGGLE_MODEL_SELECTION'; id: string }
  | { type: 'SELECT_ALL_MODELS' }
  | { type: 'CLEAR_MODEL_SELECTION' }
  | { type: 'SET_MODEL_SORT'; sortBy: ModelSortOption; direction?: 'asc' | 'desc' }
  | { type: 'SET_MODEL_FILTERS'; filters: ModelFilterOptions }
  | { type: 'REMOVE_MODEL'; id: string }

  // Drafts
  | { type: 'SET_DRAFTS'; drafts: DraftSummary[] }
  | { type: 'SET_DRAFTS_LOADING'; loading: Partial<LoadingState> }
  | { type: 'SELECT_DRAFT'; id: string }
  | { type: 'DESELECT_DRAFT'; id: string }
  | { type: 'TOGGLE_DRAFT_SELECTION'; id: string }
  | { type: 'SELECT_ALL_DRAFTS' }
  | { type: 'CLEAR_DRAFT_SELECTION' }
  | { type: 'SET_DRAFT_SORT'; sortBy: DraftSortOption; direction?: 'asc' | 'desc' }
  | { type: 'SET_DRAFT_FILTERS'; filters: DraftFilterOptions }
  | { type: 'REMOVE_DRAFT'; id: string }

  // Jobs
  | { type: 'SET_ACTIVE_JOBS'; jobs: Job[] }
  | { type: 'ADD_JOB'; job: Job }
  | { type: 'UPDATE_JOB'; job: Job }
  | { type: 'REMOVE_JOB'; id: string }
  | { type: 'SET_JOBS_LOADING'; loading: Partial<LoadingState> }
  | { type: 'SET_FOCUSED_JOB'; id: string | null }

  // UI
  | { type: 'SET_COMPACT_MODE'; isCompact: boolean }
  | { type: 'SET_BULK_SELECT_MODE'; enabled: boolean }
  | { type: 'RESET_STATE' };

// =============================================================================
// Context
// =============================================================================

export interface DashboardContextValue {
  /** Current dashboard state */
  state: DashboardState;
  /** Dispatch function for actions */
  dispatch: Dispatch<DashboardAction>;
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);
