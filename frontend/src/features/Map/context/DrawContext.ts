/**
 * Draw context object and the hooks that read it.
 *
 * Deliberately kept at this path, and deliberately holding the hooks rather
 * than only the context object. Consumers import `useDraw` / `useDrawOptional`
 * from '../context/DrawContext', and three test files mock that exact module
 * specifier. Moving the hooks elsewhere would leave those vi.mock calls
 * pointing at a module nobody imports any more — they would stop intercepting
 * silently rather than failing, and useDrawOptional returns null instead of
 * throwing, so the tests could keep passing while exercising nothing.
 *
 * The provider component lives in DrawProvider.tsx so that file exports nothing
 * but a component, which is what Vite's fast refresh needs.
 */

import { createContext, useContext } from 'react';
import type { DrawingMode, DrawnFeature, DrawingState } from '../types/geometry';

/**
 * Draw context value
 */
export interface DrawContextValue {
  /** Current drawing state */
  state: DrawingState;
  /** Set drawing mode */
  setMode: (mode: DrawingMode) => void;
  /** Get all drawn features */
  getFeatures: () => DrawnFeature[];
  /** Delete selected features */
  deleteSelected: () => void;
  /** Delete all features */
  deleteAll: () => void;
  /** Add features programmatically */
  addFeatures: (features: DrawnFeature[]) => void;
  /** Whether drawing is ready */
  isReady: boolean;
  /** Register a callback for create events */
  onCreateSubscribe: (callback: (features: DrawnFeature[]) => void) => () => void;
  /** Register a callback for update events */
  onUpdateSubscribe: (callback: (features: DrawnFeature[]) => void) => () => void;
  /** Register a callback for delete events */
  onDeleteSubscribe: (callback: (features: DrawnFeature[]) => void) => () => void;
}

export const DrawContext = createContext<DrawContextValue | null>(null);

/**
 * Hook to access the shared draw context.
 *
 * @throws Error if used outside of DrawProvider
 */
export function useDraw(): DrawContextValue {
  const context = useContext(DrawContext);
  if (!context) {
    throw new Error('useDraw must be used within a DrawProvider');
  }
  return context;
}

/**
 * Optional version of useDraw that returns null if no provider.
 *
 * Use this when the component may be rendered outside of DrawProvider,
 * such as when embedded in a host application that provides its own map.
 */
export function useDrawOptional(): DrawContextValue | null {
  return useContext(DrawContext);
}
