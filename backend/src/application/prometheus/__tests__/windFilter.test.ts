/**
 * WindNinja wind grids (refs #294).
 *
 * `Dogrib_v624.fgmj` declares a filter of kind `wind` — "WindNinja Ang (Mass)",
 * a WindNinja-generated wind field. The importer knew only polyWeather,
 * polyReplace and replace, so it refused the ENTIRE file over the one filter it
 * could not apply.
 *
 * Franco's call, 2026-10-01: "skip and notify wind ninja, we are not ready for
 * that yet." So it behaves like a fuel patch — the scenario imports, and the
 * operator is told the imported run uses Nomad's wind where the original used
 * a WindNinja field.
 *
 * That divergence matters more than most. WindNinja exists because terrain
 * steers wind, and wind direction decides where a fire goes. An imported Dogrib
 * run is not the Dogrib run; it is a comparable run with simpler wind, and the
 * notice must say so.
 *
 * The real file is 13.5 MB in an archive directory, so it is not committed as a
 * fixture. These drive the real resolveScenarios entry with the smallest
 * project that reaches the filter resolver — no seam opened for the test.
 */

import { describe, it, expect } from 'vitest';
import { resolveScenarios } from '../resolveScenarios.js';
import type { FgmjProject } from '../loadFgmjProject.js';

const WIND_NINJA = 'WindNinja Ang (Mass)';

const projectWithFilter = (entry: Record<string, unknown>): FgmjProject => ({
  scenarios: [
    {
      name: 'scenario under test',
      raw: {
        name: 'scenario under test',
        scenario: {
          startTime: { time: '2021-09-02T13:00:00-06:00' },
          endTime: { time: '2021-09-05T13:00:00-06:00' },
        },
        filterIndex: [{ name: WIND_NINJA }],
        weatherIndex: [{
          stationIndex: { name: 'station1' },
          streamIndex: { name: 'stream1' },
        }],
      },
    } as unknown as FgmjProject['scenarios'][number],
  ],
  ignitions: [],
  stations: [
    {
      name: 'station1',
      station: { name: 'station1', streams: [{ name: 'stream1' }] },
    },
  ],
  weatherFilters: [entry],
  raw: {},
  baseDir: '/nonexistent',
});

describe('a wind filter is recognised rather than refusing the file', () => {
  it('resolves kind "wind"', () => {
    const [scenario] = resolveScenarios(
      projectWithFilter({ wind: { name: WIND_NINJA, landscape: true } }),
    );
    const wind = scenario.weatherFilters.find((f) => f.name === WIND_NINJA);
    expect(wind).toBeDefined();
    expect(wind!.kind).toBe('wind');
  });

  it('still refuses a kind it genuinely does not know', () => {
    expect(() =>
      resolveScenarios(projectWithFilter({ gribStream: { name: WIND_NINJA } })),
    ).toThrow(/unknown kind/i);
  });

  it('names wind among the kinds it handles when refusing another', () => {
    let message = '';
    try {
      resolveScenarios(projectWithFilter({ gribStream: { name: WIND_NINJA } }));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('wind');
  });
});
