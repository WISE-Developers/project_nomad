/**
 * Submit gate for daily-only CFFDRS weather — issue #351.
 *
 * Sits between the wizard finishing and onComplete firing. When the uploaded
 * FireSTARR CSV records its indices once a day, submitting it as-is writes NaN
 * onto the FireSTARR command line and segfaults the engine. The codes are in
 * the file, so we hold the submission, offer what we found, and proceed only on
 * an explicit yes.
 *
 * This lives inside features/ModelSetup/ deliberately. The wizard forwards to a
 * host-supplied onComplete — App.tsx is only the SAN reference implementation —
 * so gating here reaches every consumer, including ACN integrators, without
 * changing any exported prop signature.
 *
 * The check runs at submit rather than at upload because the reading offered is
 * the last one before ignition. An answer given at upload goes stale the moment
 * the user changes the ignition time.
 */

import { useCallback, useState } from 'react';
import {
  preflightWeather as defaultPreflight,
  type PreflightRequest,
  type PreflightResponse,
  type PreflightRhythm,
} from '../../../services/api.js';
import {
  needsPreflight,
  buildIgnitionInstant,
  applyStartingCodes,
  readFileText,
  type StartingCodeCandidate,
} from '../utils/weatherPreflight.js';
import type { ModelSetupData } from '../types/index.js';

/** The held submission, surfaced so the wizard can render the question. */
export interface PreflightGate {
  /** What was found, or null when nothing precedes ignition. */
  candidate: StartingCodeCandidate | null;
  /** How the file's rhythm compares with the timezone contract (#354). */
  rhythm: PreflightRhythm | null;
  /** The model's declared zone, so the question can name it back to the user. */
  timezone: string;
  /** Accept the codes and submit on the raw_weather path. */
  confirm: () => Promise<void>;
  /** Abandon. Nothing was created, so there is nothing to clean up. */
  cancel: () => void;
}

interface Deps {
  preflight?: (body: PreflightRequest) => Promise<PreflightResponse>;
}

export interface UseWeatherPreflightGateReturn {
  /** Drop-in replacement for the wizard's completion handler. */
  guardedComplete: (data: ModelSetupData) => Promise<void>;
  /** Non-null while the user is being asked. */
  gate: PreflightGate | null;
  /** Set when the check itself failed. Submission is blocked, not guessed. */
  error: string | null;
}

export function useWeatherPreflightGate(
  onComplete: ((data: ModelSetupData) => void | Promise<void>) | undefined,
  deps: Deps = {},
): UseWeatherPreflightGateReturn {
  const preflight = deps.preflight ?? defaultPreflight;

  const [gate, setGate] = useState<PreflightGate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guardedComplete = useCallback(
    async (data: ModelSetupData) => {
      setError(null);

      // raw_weather already carries explicit starting codes and spotwx is
      // generated, so neither is worth a round-trip.
      if (!needsPreflight(data.weather)) {
        await onComplete?.(data);
        return;
      }

      const file = data.weather.firestarrCsvFile;
      if (!file) {
        await onComplete?.(data);
        return;
      }

      let result: PreflightResponse;
      try {
        const start = buildIgnitionInstant(data.temporal);
        const end = new Date(
          new Date(start).getTime() + data.temporal.durationHours * 60 * 60 * 1000,
        ).toISOString();

        result = await preflight({
          timezone: data.temporal.timezone,
          timeRange: { start, end },
          weather: { source: 'firestarr_csv', firestarrCsvContent: await readFileText(file) },
        });
      } catch (e) {
        // Fail-fast: the check exists to prevent a segfault, so proceeding
        // while its result is unknown would defeat it.
        setError(e instanceof Error ? e.message : String(e));
        return;
      }

      if (!result.dailyOnlyCffdrs) {
        await onComplete?.(data);
        return;
      }

      setGate({
        candidate: result.candidate,
        rhythm: result.rhythm,
        timezone: data.temporal.timezone,
        confirm: async () => {
          setGate(null);
          if (result.candidate) {
            await onComplete?.(applyStartingCodes(data, result.candidate));
          }
        },
        cancel: () => setGate(null),
      });
    },
    [onComplete, preflight],
  );

  return { guardedComplete, gate, error };
}
