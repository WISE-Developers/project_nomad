/**
 * The submit gate — issue #351.
 *
 * Sits between the wizard finishing and onComplete firing. If the uploaded
 * weather has the daily-only CFFDRS shape it holds the submission, offers the
 * codes found in the user's own file, and only proceeds on an explicit yes.
 *
 * Extracted from ModelSetupWizard so the state machine is testable: no harness
 * exists for the wizard's submit path, and driving the whole wizard through
 * every step to reach it would test the steps, not this.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWeatherPreflightGate } from '../useWeatherPreflightGate.js';
import type { ModelSetupData } from '../../types/index.js';

const CANDIDATE = {
  ffmc: 84.65,
  dmc: 20.72,
  dc: 424.9,
  observedAt: '2026-08-04T01:06:00.000Z',
  localLabel: '2026-08-03, 1900',
};

function csvFile(): File {
  return new File(['Scenario,Date\n0,2026-08-01 00:06:00'], 'station.csv', { type: 'text/csv' });
}

function firestarrData(): ModelSetupData {
  return {
    geometry: {},
    temporal: {
      startDate: '2026-08-04',
      startTime: '12:00',
      durationHours: 72,
      timezone: 'America/Edmonton',
      isForecast: false,
    },
    model: {},
    weather: {
      source: 'firestarr_csv',
      firestarrCsvFile: csvFile(),
      firestarrCsvFileName: 'station.csv',
    },
  } as unknown as ModelSetupData;
}

describe('useWeatherPreflightGate', () => {
  let onComplete: ReturnType<typeof vi.fn>;
  let preflight: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onComplete = vi.fn();
    preflight = vi.fn().mockResolvedValue({ dailyOnlyCffdrs: false, candidate: null });
  });

  function setup() {
    return renderHook(() => useWeatherPreflightGate(onComplete, { preflight }));
  }

  it('submits straight through when the file is fine', async () => {
    const { result } = setup();
    const data = firestarrData();

    await act(async () => {
      await result.current.guardedComplete(data);
    });

    expect(onComplete).toHaveBeenCalledWith(data);
    expect(result.current.gate).toBeNull();
  });

  it('skips the round-trip entirely for a source that cannot have the shape', async () => {
    const { result } = setup();
    const data = { ...firestarrData(), weather: { source: 'spotwx' as const, spotwxFile: csvFile() } };

    await act(async () => {
      await result.current.guardedComplete(data as ModelSetupData);
    });

    expect(preflight).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  describe('when the daily-only shape is found', () => {
    beforeEach(() => {
      preflight.mockResolvedValue({ dailyOnlyCffdrs: true, candidate: CANDIDATE });
    });

    it('HOLDS the submission — onComplete must not fire behind the question', async () => {
      const { result } = setup();

      await act(async () => {
        await result.current.guardedComplete(firestarrData());
      });

      expect(onComplete).not.toHaveBeenCalled();
      expect(result.current.gate?.candidate).toEqual(CANDIDATE);
    });

    it('submits on the raw_weather path with the recovered codes when accepted', async () => {
      const { result } = setup();

      await act(async () => {
        await result.current.guardedComplete(firestarrData());
      });
      await act(async () => {
        await result.current.gate!.confirm();
      });

      expect(onComplete).toHaveBeenCalledTimes(1);
      const submitted = onComplete.mock.calls[0][0] as ModelSetupData;
      expect(submitted.weather.source).toBe('raw_weather');
      expect(submitted.weather.startingCodes).toEqual({ ffmc: 84.65, dmc: 20.72, dc: 424.9 });
    });

    it('abandons cleanly when declined — nothing submitted, nothing created', async () => {
      const { result } = setup();

      await act(async () => {
        await result.current.guardedComplete(firestarrData());
      });
      act(() => {
        result.current.gate!.cancel();
      });

      expect(onComplete).not.toHaveBeenCalled();
      await waitFor(() => expect(result.current.gate).toBeNull());
    });

    it('carries the rhythm and the declared zone into the question', async () => {
      // The user is told how far their file sits from the contract (#354),
      // named against the zone they chose.
      preflight.mockResolvedValue({
        dailyOnlyCffdrs: true,
        candidate: CANDIDATE,
        rhythm: { dailyHour: 19, hoursFromNoon: 6, likelyZoneMismatch: true },
      });
      const { result } = setup();

      await act(async () => {
        await result.current.guardedComplete(firestarrData());
      });

      expect(result.current.gate?.rhythm?.hoursFromNoon).toBe(6);
      expect(result.current.gate?.timezone).toBe('America/Edmonton');
    });

    it('sends the file content and the ignition instant to the check', async () => {
      const { result } = setup();

      await act(async () => {
        await result.current.guardedComplete(firestarrData());
      });

      const sent = preflight.mock.calls[0][0];
      expect(sent.weather.firestarrCsvContent).toContain('Scenario,Date');
      expect(sent.timezone).toBe('America/Edmonton');
      expect(sent.timeRange.start).toMatch(/Z$|[+-]\d{2}:\d{2}$/);
    });
  });

  it('opens the gate with no candidate when the shape is found but nothing precedes ignition', async () => {
    preflight.mockResolvedValue({ dailyOnlyCffdrs: true, candidate: null });
    const { result } = setup();

    await act(async () => {
      await result.current.guardedComplete(firestarrData());
    });

    expect(result.current.gate).not.toBeNull();
    expect(result.current.gate?.candidate).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('blocks submission when the check itself fails, rather than guessing', async () => {
    // Fail-fast. The check exists to stop a segfault; proceeding while its
    // result is unknown defeats the point.
    preflight.mockRejectedValue(new Error('Required column "date" not found in CSV'));
    const { result } = setup();

    await act(async () => {
      await result.current.guardedComplete(firestarrData());
    });

    expect(onComplete).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/date/);
  });
});
