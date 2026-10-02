/**
 * Resolving each scenario's references and time window (refs #294).
 *
 * Two things this has to get right, both of which the field naming works
 * against:
 *
 * 1. `fireIndex`, `weatherIndex` and `filterIndex` hold NAMES, not indices.
 *    Objects are declared once under project.ignitions / .stations /
 *    .grids.filters and every scenario points at them by name. Every lookup is
 *    therefore a failure point, and that is where stop-and-alert earns its keep.
 *
 * 2. Duration comes from the SCENARIO window, never from the weather. The
 *    fixture makes that unmissable: all three scenarios reference the same
 *    stream `wthrstrm5`, and run for 24, 24 and 72 hours. Any duration derived
 *    from the stream would give all three the same answer.
 *    (tools/extract-wise-jobs.ts sets durationHours = weatherRows.length. That
 *    is wrong for this purpose and must not be carried over.)
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFgmjProject } from '../loadFgmjProject.js';
import { resolveScenarios } from '../resolveScenarios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (name: string) => path.join(TEST_DATA, name);

const threeScenarios = () =>
  loadFgmjProject(fixture('prometheus_job_SS008-25_3scenarios.fgmj'));

describe('resolveScenarios', () => {
  describe('one scenario becomes one importable model', () => {
    it('resolves all three scenarios', () => {
      const resolved = resolveScenarios(threeScenarios());

      expect(resolved).toHaveLength(3);
      expect(resolved.map((s) => s.name)).toEqual([
        'SS008-25 BEST Case Scenario',
        'SS008-25 WORST Case Scenario',
        'SS008-25 3 Day Scenario',
      ]);
    });

    it('resolves the ignition, station and stream each scenario names', () => {
      const [best] = resolveScenarios(threeScenarios());

      expect(best.ignitionNames).toEqual(['ign5']);
      expect(best.stationName).toBe('wthrstn5');
      expect(best.streamName).toBe('wthrstrm5');
      // resolved, not merely named
      expect(best.ignitions).toHaveLength(1);
      expect(best.station).toBeDefined();
      expect(best.stream).toBeDefined();
    });
  });

  describe('duration comes from the scenario window, never the weather', () => {
    it('gives the three scenarios 24, 24 and 72 hours', () => {
      const resolved = resolveScenarios(threeScenarios());

      expect(resolved.map((s) => s.durationHours)).toEqual([24, 24, 72]);
    });

    it('does so even though all three share one weather stream', () => {
      // If duration were derived from the stream, these could not differ.
      const resolved = resolveScenarios(threeScenarios());

      expect(new Set(resolved.map((s) => s.streamName)).size).toBe(1);
      expect(new Set(resolved.map((s) => s.durationHours)).size).toBe(2);
    });

    it('carries the window through with its offset intact', () => {
      const [best] = resolveScenarios(threeScenarios());

      expect(best.startTime).toBe('2025-06-26T13:00:00-06:00');
      expect(best.endTime).toBe('2025-06-27T13:00:00-06:00');
    });
  });

  describe('weather patches are per scenario, not per file', () => {
    it('gives each scenario only the filters it names', () => {
      const [best, worst, threeDay] = resolveScenarios(threeScenarios());

      expect(best.weatherFilterNames).toEqual(['wthrptch10']);
      expect(worst.weatherFilterNames).toEqual(['wthrptch11']);
      // The file declares both patches; this scenario references neither.
      expect(threeDay.weatherFilterNames).toEqual([]);
    });

    it('resolves a named filter to the declared object', () => {
      const [best] = resolveScenarios(threeScenarios());

      expect(best.weatherFilters).toHaveLength(1);
      expect(best.weatherFilters[0].name).toBe('wthrptch10');
    });
  });

  describe('stop and alert on an unresolved reference', () => {
    it('throws naming the missing ignition and the scenario that wanted it', () => {
      const project = threeScenarios();
      const entry = project.scenarios[0].raw as Record<string, unknown>;
      entry.fireIndex = [{ name: 'no-such-ignition' }];

      expect(() => resolveScenarios(project)).toThrow(/no-such-ignition/);
      expect(() => resolveScenarios(project)).toThrow(/SS008-25 BEST Case Scenario/);
    });

    it('throws naming a missing weather filter', () => {
      const project = threeScenarios();
      const entry = project.scenarios[0].raw as Record<string, unknown>;
      entry.filterIndex = [{ name: 'no-such-patch' }];

      expect(() => resolveScenarios(project)).toThrow(/no-such-patch/);
    });

    it('throws naming a missing station', () => {
      const project = threeScenarios();
      const entry = project.scenarios[0].raw as Record<string, unknown>;
      entry.weatherIndex = [
        { stationIndex: { name: 'no-such-station' }, streamIndex: { name: 'wthrstrm5' } },
      ];

      expect(() => resolveScenarios(project)).toThrow(/no-such-station/);
    });

    it('throws naming a missing stream', () => {
      const project = threeScenarios();
      const entry = project.scenarios[0].raw as Record<string, unknown>;
      entry.weatherIndex = [
        { stationIndex: { name: 'wthrstn5' }, streamIndex: { name: 'no-such-stream' } },
      ];

      expect(() => resolveScenarios(project)).toThrow(/no-such-stream/);
    });
  });

  describe('the rest of the corpus', () => {
    it('resolves every scenario in every fixture', () => {
      for (const f of [
        'prometheus_job_SS008-25_3scenarios.fgmj',
        'prometheus_job_sage1_patches_multiignition.fgmj',
        'prometheus_job_sage2_polygon_winddirection.fgmj',
        'prometheus_job_sage3_divide_compass.fgmj',
      ]) {
        const resolved = resolveScenarios(loadFgmjProject(fixture(f)));
        expect(resolved.length, f).toBeGreaterThan(0);
        for (const s of resolved) {
          expect(s.durationHours, `${f} / ${s.name}`).toBeGreaterThan(0);
        }
      }
    });
  });
});
