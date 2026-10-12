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
import { toRequestedIgnitions } from '../utils/toRequestedIgnitions.js';

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

/**
 * The held submission for an extent advisory (#432).
 *
 * Distinct from `error` on purpose. A 200 km fire is legal and will run; the
 * operator is being told where the cliff is while they still have the choice to
 * split the model. An error blocks; this asks.
 */
export interface ExtentWarning {
  /** Written for an operator, from the backend. */
  message: string;
  /** Acknowledge and submit. */
  proceed: () => Promise<void>;
  /** Go back and redraw. Nothing was created. */
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
  /** Non-null while the operator is being shown an extent advisory (#432). */
  extentWarning: ExtentWarning | null;
}

export function useWeatherPreflightGate(
  onComplete: ((data: ModelSetupData) => void | Promise<void>) | undefined,
  deps: Deps = {},
): UseWeatherPreflightGateReturn {
  const preflight = deps.preflight ?? defaultPreflight;

  const [gate, setGate] = useState<PreflightGate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extentWarning, setExtentWarning] = useState<ExtentWarning | null>(null);

  const guardedComplete = useCallback(
    async (data: ModelSetupData) => {
      setError(null);
      setExtentWarning(null);

      const weatherNeedsCheck = needsPreflight(data.weather) && Boolean(data.weather.firestarrCsvFile);

      /**
       * ALWAYS round-trips now, and this is the change that matters.
       *
       * Previously this returned early for spotwx and raw_weather — correctly,
       * because the weather question only concerns the file. But the EXTENT
       * question concerns the geometry, which every run has regardless of where
       * its weather comes from. Keeping the early return would have delivered
       * the #432 warning through a code path that never executes on two of the
       * three weather sources.
       */
      let result: PreflightResponse;
      try {
        const start = buildIgnitionInstant(data.temporal);
        const end = new Date(
          new Date(start).getTime() + data.temporal.durationHours * 60 * 60 * 1000,
        ).toISOString();

        result = await preflight({
          timezone: data.temporal.timezone,
          timeRange: { start, end },
          weather: weatherNeedsCheck
            ? {
                source: 'firestarr_csv',
                firestarrCsvContent: await readFileText(data.weather.firestarrCsvFile!),
              }
            : { source: data.weather.source },
          // All of them. Taking features[0] would understate the span of a fire
          // drawn as several fronts, and understating an extent is the unsafe
          // direction — the engine crops in silence (#294 taught this on the
          // execution path).
          ignitions: toRequestedIgnitions(data.geometry?.features ?? []),
        });
      } catch (e) {
        if (weatherNeedsCheck) {
          // Fail-fast: this check exists to prevent a segfault, so proceeding
          // while its result is unknown would defeat it.
          setError(e instanceof Error ? e.message : String(e));
          return;
        }
        // The weather check was not needed, so the only thing lost is an
        // ADVISORY. Blocking a legal run because an advisory was unreachable
        // would be the wrong trade — but it is said out loud rather than
        // swallowed, so an unreachable check is never mistaken for a clean one.
        console.warn(
          '[preflight] extent advisory unavailable; the run is proceeding unchecked:',
          e instanceof Error ? e.message : String(e),
        );
        await onComplete?.(data);
        return;
      }

      // ── Extent first. A refusal outranks everything else. ──
      const extent = result.extent;
      if (extent && !extent.withinLimit) {
        setError(extent.reason ?? 'This fire is too large for FireSTARR to simulate.');
        return;
      }

      const finishWeather = async () => {
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
      };

      // `measured` is load-bearing: an extent that was never measured must not
      // be reported as one that was measured and found fine.
      if (extent?.measured && extent.nearLimit && extent.warning) {
        const warning = extent.warning;
        setExtentWarning({
          message: warning,
          proceed: async () => {
            setExtentWarning(null);
            await finishWeather();
          },
          cancel: () => setExtentWarning(null),
        });
        return;
      }

      await finishWeather();
    },
    [onComplete, preflight],
  );

  return { guardedComplete, gate, error, extentWarning };
}
