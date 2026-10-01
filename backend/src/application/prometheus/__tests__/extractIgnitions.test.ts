/**
 * Ignition geometry and the projection question (refs #294).
 *
 * THE WORST FAILURE AVAILABLE IN THIS IMPORTER.
 *
 * The .fgmj names a projection but does not carry one: `projectionName:
 * "dataset"` refers to a .prj that lived beside the fuel grid on the original
 * author's machine, which nobody ships with a years-old job file. Meanwhile the
 * coordinates themselves may be lat/lon or projected metres depending on what
 * the author's fuel and elevation data used.
 *
 * FireSTARR's CLI takes lat/lon, so a projected file cannot be converted
 * without the CRS. Guessing one produces a run that completes, looks entirely
 * plausible, and places the fire hundreds of kilometres from where it was.
 *
 * So: detect, then ask. |x| <= 180 and |y| <= 90 means lat/lon; anything else
 * is projected and the operator must supply the CRS. Never guess.
 *
 * Note the ignition carries `units: "UTM"` while the sample's real CRS is
 * ESRI:102001 Canada Albers. That label means "projected" generically, not
 * literally UTM, and must never be read as a CRS.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFgmjProject } from '../loadFgmjProject.js';
import { resolveScenarios } from '../resolveScenarios.js';
import { extractIgnitions } from '../extractIgnitions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');

const scenariosOf = (file: string) =>
  resolveScenarios(loadFgmjProject(path.join(TEST_DATA, file)));

describe('extractIgnitions', () => {
  describe('real Prometheus ignitions, which are projected', () => {
    it('extracts the single ignition and its points', () => {
      const [best] = scenariosOf('prometheus_job_SS008-25_3scenarios.fgmj');
      const ignitions = extractIgnitions(best);

      expect(ignitions).toHaveLength(1);
      expect(ignitions[0].polyType).toBe('POLYGON_OUT');
      expect(ignitions[0].points.length).toBeGreaterThan(0);
      expect(ignitions[0].points[0].x).toBeCloseTo(-1114437.3566378944, 6);
      expect(ignitions[0].points[0].y).toBeCloseTo(2423419.0519584483, 6);
    });

    it('extracts both ignitions when a scenario has two', () => {
      // Multiple ignitions are supported, not an error.
      const [best] = scenariosOf('prometheus_job_sage1_patches_multiignition.fgmj');
      const ignitions = extractIgnitions(best);

      expect(ignitions).toHaveLength(2);
      expect(ignitions.map((i) => i.polyType)).toEqual(['POLYGON_OUT', 'POINT']);
    });

    it('carries the ignition start time through with its offset', () => {
      const [best] = scenariosOf('prometheus_job_SS008-25_3scenarios.fgmj');
      const [ignition] = extractIgnitions(best);

      expect(ignition.startTime).toBe('2025-06-26T13:00:00-06:00');
    });
  });

  describe('detect, then ask — never guess', () => {
    it('reports the real fixtures as projected, needing a CRS', () => {
      const [best] = scenariosOf('prometheus_job_SS008-25_3scenarios.fgmj');
      const [ignition] = extractIgnitions(best);

      expect(ignition.coordinateSystem).toBe('projected');
      expect(ignition.requiresCrs).toBe(true);
    });

    it('offers no CRS of its own for a projected ignition', () => {
      const [best] = scenariosOf('prometheus_job_sage1_patches_multiignition.fgmj');
      const ignitions = extractIgnitions(best);

      for (const ignition of ignitions) {
        // The sample really is ESRI:102001, but the FILE does not say so.
        // Anything here would be a guess, and a guess is the failure mode.
        expect(ignition.crs).toBeUndefined();
        // Nor may it hand back lat/lon it could not have computed.
        expect(ignition.latLonPoints).toBeUndefined();
      }
    });

    it('never treats the "UTM" units label as a CRS', () => {
      const [best] = scenariosOf('prometheus_job_sage1_patches_multiignition.fgmj');
      const [ignition] = extractIgnitions(best);

      // The label says UTM; the data is Albers. It means "projected", loosely.
      expect(ignition.crs).toBeUndefined();
      expect(JSON.stringify(ignition)).not.toMatch(/EPSG|ESRI:/);
    });
  });

  describe('the lat/lon rule', () => {
    const latLonScenario = (x: number, y: number) => {
      const [best] = scenariosOf('prometheus_job_SS008-25_3scenarios.fgmj');
      const ignition = best.ignitions[0] as Record<string, unknown>;
      const inner = ignition.ignition as Record<string, unknown>;
      const list = (inner.ignitions as Record<string, unknown>).ignitions as Record<
        string,
        unknown
      >[];
      const poly = (list[0].polygon as Record<string, unknown>).polygon as Record<
        string,
        unknown
      >;
      poly.points = [{ x: { value: x }, y: { value: y } }];
      return best;
    };

    it('treats coordinates inside the lat/lon envelope as lat/lon', () => {
      // The WISE sample's ignition, which is directly usable.
      const [ignition] = extractIgnitions(latLonScenario(-116.0728, 60.6161));

      expect(ignition.coordinateSystem).toBe('latLon');
      expect(ignition.requiresCrs).toBe(false);
    });

    it('accepts the exact envelope bounds', () => {
      expect(extractIgnitions(latLonScenario(180, 90))[0].coordinateSystem).toBe('latLon');
      expect(extractIgnitions(latLonScenario(-180, -90))[0].coordinateSystem).toBe('latLon');
    });

    it('treats a latitude just outside the envelope as projected', () => {
      expect(extractIgnitions(latLonScenario(0, 90.0001))[0].coordinateSystem).toBe(
        'projected',
      );
    });

    it('treats a longitude just outside the envelope as projected', () => {
      expect(extractIgnitions(latLonScenario(180.0001, 0))[0].coordinateSystem).toBe(
        'projected',
      );
    });
  });

  describe('stop and alert', () => {
    it('refuses an ignition with no points rather than returning an empty fire', () => {
      const [best] = scenariosOf('prometheus_job_SS008-25_3scenarios.fgmj');
      const ignition = best.ignitions[0] as Record<string, unknown>;
      const inner = ignition.ignition as Record<string, unknown>;
      const list = (inner.ignitions as Record<string, unknown>).ignitions as Record<
        string,
        unknown
      >[];
      const poly = (list[0].polygon as Record<string, unknown>).polygon as Record<
        string,
        unknown
      >;
      poly.points = [];

      expect(() => extractIgnitions(best)).toThrow(/point/i);
    });
  });
});
