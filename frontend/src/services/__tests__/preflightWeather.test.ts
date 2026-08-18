/**
 * API client for the pre-flight weather check — issue #351.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { preflightWeather } from '../api.js';

const OK_RESPONSE = {
  dailyOnlyCffdrs: true,
  candidate: {
    ffmc: 84.65,
    dmc: 20.72,
    dc: 424.9,
    observedAt: '2026-08-04T01:06:00.000Z',
    localLabel: '2026-08-03, 1900',
  },
};

const REQUEST = {
  timezone: 'America/Edmonton',
  timeRange: { start: '2026-08-04T18:00:00.000Z', end: '2026-08-07T18:00:00.000Z' },
  weather: { source: 'firestarr_csv' as const, firestarrCsvContent: 'Scenario,Date\n0,x' },
};

describe('preflightWeather', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => OK_RESPONSE });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to the versioned endpoint', async () => {
    await preflightWeather(REQUEST);

    const [url, config] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/models/preflight');
    expect(config.method).toBe('POST');
  });

  it('sends the weather content in the body', async () => {
    await preflightWeather(REQUEST);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.weather.firestarrCsvContent).toBe('Scenario,Date\n0,x');
    expect(body.timezone).toBe('America/Edmonton');
    expect(body.timeRange.start).toBe('2026-08-04T18:00:00.000Z');
  });

  it('returns the parsed result', async () => {
    const result = await preflightWeather(REQUEST);

    expect(result.dailyOnlyCffdrs).toBe(true);
    expect(result.candidate?.ffmc).toBe(84.65);
    expect(result.candidate?.localLabel).toBe('2026-08-03, 1900');
  });

  it('surfaces a rejected file as a thrown error rather than a silent pass', async () => {
    // A 400 here means the CSV could not be parsed. Swallowing it would send
    // the user straight into the segfault this check exists to prevent.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify({ error: 'Required column "date" not found in CSV' }),
    });

    await expect(preflightWeather(REQUEST)).rejects.toThrow();
  });
});
