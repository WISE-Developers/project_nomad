/**
 * useLayers — hook to access layer context.
 */

import { useContext } from 'react';
import { LayerContext } from './LayerContext';

/**
 * Hook to access layer context
 */
export function useLayers() {
  const context = useContext(LayerContext);
  if (!context) {
    throw new Error('useLayers must be used within a LayerProvider');
  }
  return context;
}
