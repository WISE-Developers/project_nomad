/**
 * Dashboard Context
 *
 * Provides centralized state management for the Dashboard component.
 * Manages models from API, drafts from localStorage, active jobs, and UI state.
 *
 * @module features/Dashboard/context
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
  type Dispatch,
} from 'react';
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
// Initial State
// =============================================================================

const initialLoadingState: LoadingState = {
  isLoading: false,
  error: null,
  lastFetched: null,
};

const initialState: DashboardState = {
  activeTab: 'models',

  models: [],
  modelsLoading: { ...initialLoadingState },
  selectedModelIds: [],
  modelSortBy: 'createdAt',
  modelSortDirection: 'desc',
  modelFilters: {},

  drafts: [],
  draftsLoading: { ...initialLoadingState },
  selectedDraftIds: [],
  draftSortBy: 'updatedAt',
  draftSortDirection: 'desc',
  draftFilters: {},

  activeJobs: [],
  jobsLoading: { ...initialLoadingState },
  focusedJobId: null,

  isCompact: false,
  bulkSelectMode: false,
};

// =============================================================================
// Reducer
// =============================================================================

function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    // Tab navigation
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.tab };

    // Models
    case 'SET_MODELS':
      return { ...state, models: action.models };

    case 'SET_MODELS_LOADING':
      return {
        ...state,
        modelsLoading: { ...state.modelsLoading, ...action.loading },
      };

    case 'SELECT_MODEL':
      return state.selectedModelIds.includes(action.id)
        ? state
        : { ...state, selectedModelIds: [...state.selectedModelIds, action.id] };

    case 'DESELECT_MODEL':
      return {
        ...state,
        selectedModelIds: state.selectedModelIds.filter((id) => id !== action.id),
      };

    case 'TOGGLE_MODEL_SELECTION':
      return state.selectedModelIds.includes(action.id)
        ? { ...state, selectedModelIds: state.selectedModelIds.filter((id) => id !== action.id) }
        : { ...state, selectedModelIds: [...state.selectedModelIds, action.id] };

    case 'SELECT_ALL_MODELS':
      return { ...state, selectedModelIds: state.models.map((m) => m.id) };

    case 'CLEAR_MODEL_SELECTION':
      return { ...state, selectedModelIds: [] };

    case 'SET_MODEL_SORT':
      return {
        ...state,
        modelSortBy: action.sortBy,
        modelSortDirection: action.direction ?? (state.modelSortBy === action.sortBy
          ? (state.modelSortDirection === 'asc' ? 'desc' : 'asc')
          : 'desc'),
      };

    case 'SET_MODEL_FILTERS':
      return { ...state, modelFilters: action.filters };

    case 'REMOVE_MODEL':
      return {
        ...state,
        models: state.models.filter((m) => m.id !== action.id),
        selectedModelIds: state.selectedModelIds.filter((id) => id !== action.id),
      };

    // Drafts
    case 'SET_DRAFTS':
      return { ...state, drafts: action.drafts };

    case 'SET_DRAFTS_LOADING':
      return {
        ...state,
        draftsLoading: { ...state.draftsLoading, ...action.loading },
      };

    case 'SELECT_DRAFT':
      return state.selectedDraftIds.includes(action.id)
        ? state
        : { ...state, selectedDraftIds: [...state.selectedDraftIds, action.id] };

    case 'DESELECT_DRAFT':
      return {
        ...state,
        selectedDraftIds: state.selectedDraftIds.filter((id) => id !== action.id),
      };

    case 'TOGGLE_DRAFT_SELECTION':
      return state.selectedDraftIds.includes(action.id)
        ? { ...state, selectedDraftIds: state.selectedDraftIds.filter((id) => id !== action.id) }
        : { ...state, selectedDraftIds: [...state.selectedDraftIds, action.id] };

    case 'SELECT_ALL_DRAFTS':
      return { ...state, selectedDraftIds: state.drafts.map((d) => d.id) };

    case 'CLEAR_DRAFT_SELECTION':
      return { ...state, selectedDraftIds: [] };

    case 'SET_DRAFT_SORT':
      return {
        ...state,
        draftSortBy: action.sortBy,
        draftSortDirection: action.direction ?? (state.draftSortBy === action.sortBy
          ? (state.draftSortDirection === 'asc' ? 'desc' : 'asc')
          : 'desc'),
      };

    case 'SET_DRAFT_FILTERS':
      return { ...state, draftFilters: action.filters };

    case 'REMOVE_DRAFT':
      return {
        ...state,
        drafts: state.drafts.filter((d) => d.id !== action.id),
        selectedDraftIds: state.selectedDraftIds.filter((id) => id !== action.id),
      };

    // Jobs
    case 'SET_ACTIVE_JOBS':
      return { ...state, activeJobs: action.jobs };

    case 'ADD_JOB':
      return { ...state, activeJobs: [...state.activeJobs, action.job] };

    case 'UPDATE_JOB':
      return {
        ...state,
        activeJobs: state.activeJobs.map((j) =>
          j.id === action.job.id ? action.job : j
        ),
      };

    case 'REMOVE_JOB':
      return {
        ...state,
        activeJobs: state.activeJobs.filter((j) => j.id !== action.id),
        focusedJobId: state.focusedJobId === action.id ? null : state.focusedJobId,
      };

    case 'SET_JOBS_LOADING':
      return {
        ...state,
        jobsLoading: { ...state.jobsLoading, ...action.loading },
      };

    case 'SET_FOCUSED_JOB':
      return { ...state, focusedJobId: action.id };

    // UI
    case 'SET_COMPACT_MODE':
      return { ...state, isCompact: action.isCompact };

    case 'SET_BULK_SELECT_MODE':
      return {
        ...state,
        bulkSelectMode: action.enabled,
        // Clear selections when exiting bulk mode
        ...(action.enabled ? {} : { selectedModelIds: [], selectedDraftIds: [] }),
      };

    case 'RESET_STATE':
      return { ...initialState };

    default:
      return state;
  }
}

// =============================================================================
// Context
// =============================================================================

interface DashboardContextValue {
  /** Current dashboard state */
  state: DashboardState;
  /** Dispatch function for actions */
  dispatch: Dispatch<DashboardAction>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export interface DashboardProviderProps {
  /** Child components */
  children: ReactNode;
  /** Initial state overrides */
  initialState?: Partial<DashboardState>;
}

/**
 * Dashboard context provider.
 *
 * Provides state management for the Dashboard component and all its children.
 */
export function DashboardProvider({
  children,
  initialState: initialStateOverrides,
}: DashboardProviderProps) {
  const [state, dispatch] = useReducer(
    dashboardReducer,
    initialStateOverrides
      ? { ...initialState, ...initialStateOverrides }
      : initialState
  );

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to access the dashboard context.
 *
 * @throws Error if used outside DashboardProvider
 */
export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider.');
  }
  return context;
}

/**
 * Hook to access dashboard context, returns null if outside provider.
 */
export function useDashboardOptional(): DashboardContextValue | null {
  return useContext(DashboardContext);
}

/**
 * Hook for accessing dashboard state only (no dispatch).
 */
export function useDashboardState(): DashboardState {
  const { state } = useDashboard();
  return state;
}

/**
 * Hook for tab-specific convenience methods.
 */
export function useDashboardTabs() {
  const { state, dispatch } = useDashboard();

  const setActiveTab = useCallback(
    (tab: DashboardTab) => dispatch({ type: 'SET_ACTIVE_TAB', tab }),
    [dispatch]
  );

  return {
    activeTab: state.activeTab,
    setActiveTab,
    isModelsTab: state.activeTab === 'models',
    isDraftsTab: state.activeTab === 'drafts',
    isJobsTab: state.activeTab === 'jobs',
  };
}

/**
 * Hook for model selection state and actions.
 */
export function useModelSelection() {
  const { state, dispatch } = useDashboard();

  const selectModel = useCallback(
    (id: string) => dispatch({ type: 'SELECT_MODEL', id }),
    [dispatch]
  );

  const deselectModel = useCallback(
    (id: string) => dispatch({ type: 'DESELECT_MODEL', id }),
    [dispatch]
  );

  const toggleModelSelection = useCallback(
    (id: string) => dispatch({ type: 'TOGGLE_MODEL_SELECTION', id }),
    [dispatch]
  );

  const selectAllModels = useCallback(
    () => dispatch({ type: 'SELECT_ALL_MODELS' }),
    [dispatch]
  );

  const clearModelSelection = useCallback(
    () => dispatch({ type: 'CLEAR_MODEL_SELECTION' }),
    [dispatch]
  );

  return {
    selectedModelIds: state.selectedModelIds,
    selectedCount: state.selectedModelIds.length,
    hasSelection: state.selectedModelIds.length > 0,
    isSelected: (id: string) => state.selectedModelIds.includes(id),
    selectModel,
    deselectModel,
    toggleModelSelection,
    selectAllModels,
    clearModelSelection,
  };
}

/**
 * Hook for draft selection state and actions.
 */
export function useDraftSelection() {
  const { state, dispatch } = useDashboard();

  const selectDraft = useCallback(
    (id: string) => dispatch({ type: 'SELECT_DRAFT', id }),
    [dispatch]
  );

  const deselectDraft = useCallback(
    (id: string) => dispatch({ type: 'DESELECT_DRAFT', id }),
    [dispatch]
  );

  const toggleDraftSelection = useCallback(
    (id: string) => dispatch({ type: 'TOGGLE_DRAFT_SELECTION', id }),
    [dispatch]
  );

  const selectAllDrafts = useCallback(
    () => dispatch({ type: 'SELECT_ALL_DRAFTS' }),
    [dispatch]
  );

  const clearDraftSelection = useCallback(
    () => dispatch({ type: 'CLEAR_DRAFT_SELECTION' }),
    [dispatch]
  );

  return {
    selectedDraftIds: state.selectedDraftIds,
    selectedCount: state.selectedDraftIds.length,
    hasSelection: state.selectedDraftIds.length > 0,
    isSelected: (id: string) => state.selectedDraftIds.includes(id),
    selectDraft,
    deselectDraft,
    toggleDraftSelection,
    selectAllDrafts,
    clearDraftSelection,
  };
}
