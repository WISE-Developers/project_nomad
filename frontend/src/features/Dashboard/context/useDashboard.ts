/**
 * Dashboard hooks — access dashboard state, tabs, selection, and view
 * navigation from the nearest DashboardProvider.
 *
 * Split out of DashboardProvider.tsx so that file exports only the
 * component (react-refresh/only-export-components).
 *
 * @module features/Dashboard/context
 */

import { useContext, useCallback } from 'react';
import { DashboardContext, type DashboardContextValue, type DashboardState, type DashboardTab } from './DashboardContext.js';

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

/**
 * Hook for view navigation within the dashboard.
 * Provides methods to switch between dashboard, wizard, and results views.
 */
export function useDashboardView() {
  const { state, dispatch } = useDashboard();

  const showDashboard = useCallback(
    () => dispatch({ type: 'SHOW_DASHBOARD' }),
    [dispatch]
  );

  const showWizard = useCallback(
    (draftId?: string) => dispatch({ type: 'SHOW_WIZARD', draftId }),
    [dispatch]
  );

  const showResults = useCallback(
    (modelId: string) => dispatch({ type: 'SHOW_RESULTS', modelId }),
    [dispatch]
  );

  return {
    activeView: state.activeView,
    wizardDraftId: state.wizardDraftId,
    resultsModelId: state.resultsModelId,
    isDashboardView: state.activeView === 'dashboard',
    isWizardView: state.activeView === 'wizard',
    isResultsView: state.activeView === 'results',
    showDashboard,
    showWizard,
    showResults,
  };
}
