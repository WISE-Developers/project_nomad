/**
 * Fetches how a model year resolves against the installed fuel datasets (#319).
 *
 * Used by model setup and results to show which fuel vintage a run uses.
 *
 * Failures are swallowed on purpose: the vintage notice is advisory, and an
 * API hiccup must not surface as an error on a fire model someone is trying to
 * run. When resolution is unavailable the notice simply renders nothing.
 */

import { useEffect, useState } from 'react';
import { getFuelDatasets } from '../../services/api';
import type { ResolvedFuelDataset } from '../utils/fuelVintage';

interface UseFuelVintageResult {
  resolved: ResolvedFuelDataset | undefined;
  loading: boolean;
}

export function useFuelVintage(modelYear: number | undefined): UseFuelVintageResult {
  const [resolved, setResolved] = useState<ResolvedFuelDataset | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (modelYear === undefined) {
      setResolved(undefined);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    getFuelDatasets(modelYear)
      .then(response => {
        if (!cancelled) {
          setResolved(response.resolved);
        }
      })
      .catch(() => {
        // Advisory only — never surfaced as an error.
        if (!cancelled) {
          setResolved(undefined);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [modelYear]);

  return { resolved, loading };
}
