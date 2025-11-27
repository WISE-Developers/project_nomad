/**
 * Drafts Hook
 *
 * Manages draft models from localStorage.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  getItemsByPrefix,
  removeItem,
  getRawItem,
} from '../../../shared/utils/storage';
import type { DraftSummary, DraftType, DraftSortOption, DraftFilterOptions } from '../types/draft';

/**
 * Storage key prefix for wizard drafts
 */
const DRAFT_KEY_PREFIX = 'nomad_wizard_draft_';

/**
 * Default TTL for drafts (30 days)
 */
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Extract draft summary from stored wizard state
 */
function extractDraftSummary(key: string, data: unknown): DraftSummary | null {
  if (!data || typeof data !== 'object') return null;

  const state = data as Record<string, unknown>;
  const draftId = (state.draftId as string) || key.replace(DRAFT_KEY_PREFIX, '');
  const steps = (state.steps as unknown[]) || [];
  const currentStep = (state.currentStepIndex as number) ?? 0;
  const totalSteps = steps.length || 1;
  const createdAt = (state.createdAt as number) || Date.now();
  const updatedAt = (state.updatedAt as number) || Date.now();

  // Calculate completion percentage
  const visitedSteps = steps.filter((s: unknown) =>
    s && typeof s === 'object' && (s as Record<string, unknown>).visited
  ).length;
  const completionPercentage = Math.round((visitedSteps / totalSteps) * 100);

  // Determine draft type from data or steps
  const draftData = state.data as Record<string, unknown> | undefined;
  let type: DraftType = 'unknown';
  let name = 'Untitled Draft';
  let description: string | undefined;

  if (draftData) {
    // Try to determine type from workflow field
    const workflow = draftData.workflow as string;
    if (workflow === 'model-setup' || workflow === 'setup') {
      type = 'model-setup';
      name = (draftData.modelName as string) || 'Fire Model';
      description = draftData.description as string;
    } else if (workflow === 'review') {
      type = 'model-review';
      name = (draftData.modelName as string) || 'Model Review';
    } else if (workflow === 'export') {
      type = 'model-export';
      name = (draftData.modelName as string) || 'Model Export';
    } else if (draftData.modelName) {
      type = 'model-setup';
      name = draftData.modelName as string;
    }
  }

  return {
    id: draftId,
    name,
    type,
    currentStep,
    totalSteps,
    completionPercentage,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
    description,
  };
}

/**
 * Sort drafts by field
 */
function sortDrafts(
  drafts: DraftSummary[],
  sortBy: DraftSortOption,
  direction: 'asc' | 'desc'
): DraftSummary[] {
  const sorted = [...drafts].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'updatedAt':
        comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
        break;
      case 'createdAt':
        comparison = a.createdAt.getTime() - b.createdAt.getTime();
        break;
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'completion':
        comparison = a.completionPercentage - b.completionPercentage;
        break;
    }

    return direction === 'desc' ? -comparison : comparison;
  });

  return sorted;
}

/**
 * Filter drafts
 */
function filterDrafts(
  drafts: DraftSummary[],
  filters: DraftFilterOptions
): DraftSummary[] {
  return drafts.filter((draft) => {
    // Filter by type
    if (filters.type && draft.type !== filters.type) {
      return false;
    }

    // Filter by search query
    if (filters.search) {
      const query = filters.search.toLowerCase();
      const matchesName = draft.name.toLowerCase().includes(query);
      const matchesDesc = draft.description?.toLowerCase().includes(query);
      if (!matchesName && !matchesDesc) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Options for useDrafts hook
 */
interface UseDraftsOptions {
  /** Auto-refresh interval in ms (0 to disable) */
  refreshInterval?: number;
  /** Initial sort field */
  sortBy?: DraftSortOption;
  /** Initial sort direction */
  sortDirection?: 'asc' | 'desc';
}

/**
 * Hook for managing draft models
 */
export function useDrafts(options: UseDraftsOptions = {}) {
  const {
    refreshInterval = 0,
    sortBy: initialSortBy = 'updatedAt',
    sortDirection: initialSortDirection = 'desc',
  } = options;

  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<DraftSortOption>(initialSortBy);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(initialSortDirection);
  const [filters, setFilters] = useState<DraftFilterOptions>({});

  // Load drafts from storage
  const loadDrafts = useCallback(() => {
    setIsLoading(true);

    try {
      const items = getItemsByPrefix<unknown>(DRAFT_KEY_PREFIX);
      const now = Date.now();

      const summaries: DraftSummary[] = [];

      for (const item of items) {
        // Check if draft is expired
        const raw = getRawItem<unknown>(item.key);
        if (raw?.expiresAt && raw.expiresAt < now) {
          removeItem(item.key);
          continue;
        }

        // Check if draft is too old (even without explicit expiry)
        if (item.updatedAt && now - item.updatedAt > DRAFT_TTL_MS) {
          removeItem(item.key);
          continue;
        }

        const summary = extractDraftSummary(item.key, item.data);
        if (summary) {
          summaries.push(summary);
        }
      }

      setDrafts(summaries);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  // Auto-refresh
  useEffect(() => {
    if (refreshInterval <= 0) return;

    const interval = setInterval(loadDrafts, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval, loadDrafts]);

  // Delete a draft
  const deleteDraft = useCallback((id: string) => {
    removeItem(`${DRAFT_KEY_PREFIX}${id}`);
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  // Delete multiple drafts
  const deleteDrafts = useCallback((ids: string[]) => {
    for (const id of ids) {
      removeItem(`${DRAFT_KEY_PREFIX}${id}`);
    }
    const idSet = new Set(ids);
    setDrafts((prev) => prev.filter((d) => !idSet.has(d.id)));
  }, []);

  // Get processed drafts (sorted and filtered)
  const processedDrafts = sortDrafts(
    filterDrafts(drafts, filters),
    sortBy,
    sortDirection
  );

  // Toggle sort direction
  const toggleSort = useCallback((field: DraftSortOption) => {
    if (sortBy === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
  }, [sortBy]);

  return {
    drafts: processedDrafts,
    allDrafts: drafts,
    isLoading,
    isEmpty: drafts.length === 0,
    sortBy,
    sortDirection,
    filters,
    setFilters,
    toggleSort,
    deleteDraft,
    deleteDrafts,
    refresh: loadDrafts,
  };
}
