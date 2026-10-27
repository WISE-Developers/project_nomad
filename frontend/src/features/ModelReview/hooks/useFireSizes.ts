/**
 * Fetches a model's fire-size ensemble (#419, served by #418).
 *
 * Goes through the openNomad adapter so embedded hosts can route it. NOTE the
 * adapter's `fetch` is a RAW passthrough — it does not prepend `/api/v1`, which
 * `services/api.ts` does. The full path is therefore spelled out here; passing
 * a bare `/models/...` silently 404s.
 */

import { useCallback, useEffect, useState } from 'react';
import { useOpenNomad } from '../../../openNomad/context';
import type { FireSizeResolution } from '../types/fireSizes';

interface UseFireSizesReturn {
  resolution: FireSizeResolution | null;
  isLoading: boolean;
  /**
   * Set when the request itself failed. Distinct from a resolution saying no
   * ensemble was recorded: that is an answer, this is the absence of one.
   */
  error: string | null;
  refetch: () => Promise<void>;
}

export function useFireSizes(modelId: string | undefined): UseFireSizesReturn {
  const api = useOpenNomad();
  const [resolution, setResolution] = useState<FireSizeResolution | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSizes = useCallback(async () => {
    if (!modelId) {
      setResolution(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.fetch(`/api/v1/models/${modelId}/fire-sizes`);
      if (!response.ok) {
        throw new Error(`fire sizes request failed with status ${response.status}`);
      }
      setResolution((await response.json()) as FireSizeResolution);
    } catch (e) {
      setResolution(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, [api, modelId]);

  useEffect(() => {
    void fetchSizes();
  }, [fetchSizes]);

  return { resolution, isLoading, error, refetch: fetchSizes };
}
