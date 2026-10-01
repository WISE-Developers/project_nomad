/**
 * Dashboard Context
 *
 * Provides centralized state management for the Dashboard component.
 * Manages models from API, drafts from localStorage, active jobs, and UI state.
 *
 * @module features/Dashboard/context
 */

import {
  useReducer,
  useMemo,
  type ReactNode,
} from 'react';
import { DashboardContext, type DashboardState, type DashboardAction, type LoadingState } from './DashboardContext.js';

// =============================================================================
// Initial State
// =============================================================================

const initialLoadingState: LoadingState = {
  isLoading: false,
  error: null,
  lastFetched: null,
};

const initialState: DashboardState = {
  activeView: 'dashboard',
  wizardDraftId: null,
  resultsModelId: null,

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
    // View navigation
    case 'SHOW_DASHBOARD':
      return { ...state, activeView: 'dashboard', wizardDraftId: null, resultsModelId: null };

    case 'SHOW_WIZARD':
      return { ...state, activeView: 'wizard', wizardDraftId: action.draftId ?? null };

    case 'SHOW_RESULTS':
      return { ...state, activeView: 'results', resultsModelId: action.modelId };

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
