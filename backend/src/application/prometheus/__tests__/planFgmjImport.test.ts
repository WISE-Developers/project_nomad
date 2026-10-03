/**
 * Planning an import: what this file would produce, and what stands in the way
 * (refs #294).
 *
 * This composes the pieces — parse, resolve, patch, ignitions, weather — into
 * one answer per scenario. It deliberately produces a PLAN rather than a
 * FireSTARR model, because the sample files cannot yet produce one and saying
 * so plainly is the point:
 *
 *   FireSTARRParams requires latitude/longitude in WGS84. Every sample is in
 *   projected metres, and the CRS is not in the file. Until the operator
 *   supplies one there is no lat/lon to give, and inventing it would put the
 *   fire hundreds of kilometres away.
 *
 * So a plan carries blockers. An operator pointing Nomad at a directory of old
 * job files learns what each one needs before anything runs, which is more
 * useful than a half-built model and far better than a plausible wrong one.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { planFgmjImport } from '../planFgmjImport.js';
import { loadFgmjProject } from '../loadFgmjProject.js';
import { resolveScenarios } from '../resolveScenarios.js';
import { extractWeatherStream } from '../extractWeatherStream.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA = path.resolve(__dirname, '..', '..', '..', '..', '..', 'test-data');
const fixture = (n: string) => path.join(TEST_DATA, n);
const THREE = 'prometheus_job_SS008-25_3scenarios.fgmj';

const ESRI_ALBERS_PRJ =
  'PROJCS["Canada_Albers_Equal_Area_Conic",GEOGCS["GCS_North_American_1983",' +
  'DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Albers"],' +
  'PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],' +
  'PARAMETER["Central_Meridian",-96.0],PARAMETER["Standard_Parallel_1",50.0],' +
  'PARAMETER["Standard_Parallel_2",70.0],PARAMETER["Latitude_Of_Origin",40.0],' +
  'UNIT["Meter",1.0]]';

describe('planFgmjImport', () => {
  describe('one plan per scenario', () => {
    it('plans all three scenarios of a three-scenario file', () => {
      const plans = planFgmjImport(fixture(THREE));

      expect(plans).toHaveLength(3);
      expect(plans.map((p) => p.scenarioName)).toEqual([
        'SS008-25 BEST Case Scenario',
        'SS008-25 WORST Case Scenario',
        'SS008-25 3 Day Scenario',
      ]);
    });

    it('carries each scenario’s own window and duration', () => {
      const plans = planFgmjImport(fixture(THREE));

      expect(plans.map((p) => p.durationHours)).toEqual([24, 24, 72]);
      expect(plans[0].startTime).toBe('2025-06-26T13:00:00-06:00');
    });

    it('carries the ignitions and the starting codes', () => {
      const [best] = planFgmjImport(fixture(THREE));

      expect(best.ignitions).toHaveLength(1);
      expect(best.ignitions[0].polyType).toBe('POLYGON_OUT');
      expect(best.startingCodes.ffmc).toBeCloseTo(87, 6);
    });
  });

  describe('the scenario’s own patches are applied to its own weather', () => {
    const rawRows = () => {
      const [best] = resolveScenarios(loadFgmjProject(fixture(THREE)));
      return extractWeatherStream(best, TEST_DATA).rows;
    };

    it('raises RH by five points inside the BEST patch window', () => {
      const raw = rawRows();
      const [best] = planFgmjImport(fixture(THREE));

      // The patch runs 13:00 on the 26th to 13:00 on the 27th; the stream
      // starts at 00:00 on the 26th, so row 13 is the first hour inside it.
      expect(best.weather[13].rh).toBeCloseTo(raw[13].rh + 5, 4);
      expect(best.weather[13].temp).toBeCloseTo(raw[13].temp - 5, 4);
    });

    it('lowers RH by five points for WORST — the inverse patch', () => {
      const raw = rawRows();
      const plans = planFgmjImport(fixture(THREE));

      expect(plans[1].weather[13].rh).toBeCloseTo(raw[13].rh - 5, 4);
      expect(plans[1].weather[13].temp).toBeCloseTo(raw[13].temp + 5, 4);
    });

    it('leaves the unpatched scenario’s weather alone', () => {
      const raw = rawRows();
      const plans = planFgmjImport(fixture(THREE));

      // The 3 Day scenario names no filter, though the file declares two.
      expect(plans[2].appliedPatches).toEqual([]);
      expect(plans[2].weather[13].rh).toBeCloseTo(raw[13].rh, 6);
      expect(plans[2].weather[13].temp).toBeCloseTo(raw[13].temp, 6);
    });

    it('records which patches it applied', () => {
      const plans = planFgmjImport(fixture(THREE));

      expect(plans[0].appliedPatches).toEqual(['wthrptch10']);
      expect(plans[1].appliedPatches).toEqual(['wthrptch11']);
    });

    it('leaves rows outside the patch window untouched', () => {
      const raw = rawRows();
      const [best] = planFgmjImport(fixture(THREE));

      // Row 0 is 00:00 on the 26th, before the patch starts.
      expect(best.weather[0].rh).toBeCloseTo(raw[0].rh, 6);
    });
  });

  describe('a projection the FILE carries is read, not asked for (refs #294)', () => {
    /**
     * Franco hit this on SS008-25: "cannot be imported as it stands — crs ...
     * the .fgmj does not record which coordinate reference system they use".
     * The file records it exactly. Line 3779:
     *
     *   "projection": {
     *     "contents": "PROJCS[\"Canada_Albers_Equal_Area_Conic\",...]",
     *     "wkt":      "PROJCS[\"Canada_Albers_Equal_Area_Conic\",...]",
     *     "units":    "metre",
     *     "filename": "dataset"
     *   }
     *
     * The importer read `filename` — "dataset", a reference to a .prj that sat
     * beside the author's fuel grid — and never looked at the WKT lying in the
     * same object. extractIgnitions' own header says "the sample really is
     * ESRI:102001 (Canada Albers) ... but the FILE does not say that". It does.
     *
     * The refusal to GUESS stays right: a wrong CRS completes, looks plausible,
     * and puts the fire hundreds of kilometres away. Reading a CRS the file
     * states is not guessing. Of 66 real .fgmj files, 5 carry an inline
     * projection and 61 do not, so the blocker still has work to do — see the
     * LWF-184 case below, which must keep blocking.
     */
    it('does not raise the crs blocker when the file carries the projection', () => {
      const plans = planFgmjImport(fixture(THREE));

      for (const plan of plans) {
        expect(plan.blockers).not.toContain('crs');
      }
    });

    it('reprojects the ignitions instead of leaving them in projected metres', () => {
      const [best] = planFgmjImport(fixture(THREE));
      const [ignition] = best.ignitions;

      expect(ignition.requiresCrs).toBe(false);
      expect(ignition.latLonRings).toBeDefined();
      // Canada Albers metres for this fire reproject into the NWT. Asserted as
      // a region rather than exact coordinates: the point is that the numbers
      // are degrees on the right continent, not that they match to six places.
      const first = ignition.latLonRings![0].points[0];
      expect(first.lat).toBeGreaterThan(45);
      expect(first.lat).toBeLessThan(75);
      expect(first.lon).toBeGreaterThan(-141);
      expect(first.lon).toBeLessThan(-100);
    });

    it('records where the CRS came from, so it is not mistaken for a guess', () => {
      const [best] = planFgmjImport(fixture(THREE));
      const [ignition] = best.ignitions;

      expect(ignition.crs).toMatch(/Canada_Albers_Equal_Area_Conic/);
    });

    it('STILL blocks when the projection object carries no definition', () => {
      // The guard against over-correcting. 61 of the 66 real .fgmj files carry
      // no inline projection, and for those the refusal to guess is still the
      // whole point -- a wrong CRS completes and puts the fire in the wrong
      // place.
      //
      // Derived from the REAL file with wkt and contents stripped, rather than
      // pointing at another fixture: LWF-184 was the obvious candidate and is
      // useless here, because its ignitions are already lat/lon (-112.2258,
      // 55.678433) so it never raises this blocker at all. A guard that cannot
      // fail guards nothing.
      const raw = JSON.parse(readFileSync(fixture(THREE), 'utf-8')) as {
        project: { grid: { projection: Record<string, unknown> } };
      };
      delete raw.project.grid.projection.wkt;
      delete raw.project.grid.projection.contents;

      const dir = mkdtempSync(join(tmpdir(), 'fgmj-no-crs-'));
      try {
        const stripped = join(dir, 'stripped.fgmj');
        writeFileSync(stripped, JSON.stringify(raw));
        const plans = planFgmjImport(stripped);

        expect(plans.length).toBeGreaterThan(0);
        for (const plan of plans) {
          expect(plan.blockers).toContain('crs');
          expect(plan.ignitions[0].crs).toBeUndefined();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('reads the .prj the projection names, when it is beside the job', () => {
      // Franco: the older files point at `Inputs/dataset.prj`, "which is the
      // dataset projection file, which in theory should exist alongside the
      // jobs". It does -- 55 of the 66 real .fgmj files still have theirs. The
      // importer takes a ZIP precisely so the Inputs/ folder comes with it, so
      // the sidecar is normally right there.
      //
      // Built hermetically from the real file: inline projection stripped, the
      // real sidecar WKT written where projection.filename points. ESRI
      // flavour on purpose (D_North_American_1983, PROJECTION["Albers"]) --
      // that is what the actual dataset.prj files contain, and it is not the
      // OGC spelling the inline WKT uses.
      const raw = JSON.parse(readFileSync(fixture(THREE), 'utf-8')) as {
        project: { grid: { projection: Record<string, unknown> } };
      };
      delete raw.project.grid.projection.wkt;
      delete raw.project.grid.projection.contents;
      raw.project.grid.projection.filename = 'Inputs/dataset.prj';

      const dir = mkdtempSync(join(tmpdir(), 'fgmj-sidecar-'));
      try {
        mkdirSync(join(dir, 'Inputs'), { recursive: true });
        writeFileSync(join(dir, 'Inputs', 'dataset.prj'), ESRI_ALBERS_PRJ);
        const jobPath = join(dir, 'job.fgmj');
        writeFileSync(jobPath, JSON.stringify(raw));

        const plans = planFgmjImport(jobPath);

        expect(plans.length).toBeGreaterThan(0);
        for (const plan of plans) {
          expect(plan.blockers).not.toContain('crs');
        }
        expect(plans[0].ignitions[0].requiresCrs).toBe(false);
        expect(plans[0].ignitions[0].latLonRings).toBeDefined();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('blockers are stated, not worked around', () => {
  /**
   * The real file with its projection removed — a job that genuinely states no
   * CRS, which is what 6 of the 66 corpus files look like. Derived from the
   * real artifact rather than hand-built, so the rest of the plan is exactly
   * what production sees.
   */
  const withoutProjection = (fn: (jobPath: string) => void): void => {
    const raw = JSON.parse(readFileSync(fixture(THREE), 'utf-8')) as {
      project: { grid: { projection: Record<string, unknown> } };
    };
    delete raw.project.grid.projection.wkt;
    delete raw.project.grid.projection.contents;
    raw.project.grid.projection.filename = 'Inputs/dataset.prj'; // absent here

    const dir = mkdtempSync(join(tmpdir(), 'fgmj-noproj-'));
    try {
      const jobPath = join(dir, 'job.fgmj');
      writeFileSync(jobPath, JSON.stringify(raw));
      fn(jobPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };


    it('reports that a projected file with no recoverable CRS cannot run', () => {
      // Repurposed. This asserted the blocker against the UNMODIFIED
      // SS008-25, which carries its projection inline -- so it was asserting
      // the defect Franco hit. Refusing on a file that genuinely says nothing
      // is still right and still needs guarding; refusing on one that says so
      // plainly was the bug.
      const raw = JSON.parse(readFileSync(fixture(THREE), 'utf-8')) as {
        project: { grid: { projection: Record<string, unknown> } };
      };
      delete raw.project.grid.projection.wkt;
      delete raw.project.grid.projection.contents;
      raw.project.grid.projection.filename = 'Inputs/dataset.prj'; // absent here

      const dir = mkdtempSync(join(tmpdir(), 'fgmj-unresolvable-'));
      try {
        const jobPath = join(dir, 'job.fgmj');
        writeFileSync(jobPath, JSON.stringify(raw));
        const plans = planFgmjImport(jobPath);

        for (const plan of plans) {
          expect(plan.blockers).toContain('crs');
          expect(plan.runnable).toBe(false);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('names the blocker in terms an operator can act on', () => {
      // Repurposed: asserted against the unmodified SS008-25, which states its
      // CRS, so it was checking the wording of a refusal that should not have
      // happened. The wording still matters for the files that really do carry
      // nothing — that is the only time an operator is asked.
      withoutProjection((jobPath) => {
        const [best] = planFgmjImport(jobPath);

        expect(best.blockerDetail.join(' ')).toMatch(/projected/i);
        expect(best.blockerDetail.join(' ')).toMatch(/CRS|coordinate reference/i);
      });
    });

    it('offers no latitude or longitude it could not have computed', () => {
      // Repurposed for the same reason, and this one is the important half:
      // inventing coordinates is the failure this module exists to prevent. It
      // is only a failure when the file gave nothing to compute them FROM.
      // Against SS008-25 the plan now reports lat 60.2698 — computed from the
      // CRS the file carries, which is precisely the value extractIgnitions'
      // own axis-order note records by hand.
      withoutProjection((jobPath) => {
        const [best] = planFgmjImport(jobPath);

        expect(best.latitude).toBeUndefined();
        expect(best.longitude).toBeUndefined();
      });
    });
  });

  describe('every fixture plans without throwing', () => {
    it('plans the whole corpus', () => {
      for (const f of [
        THREE,
        'prometheus_job_sage1_patches_multiignition.fgmj',
        'prometheus_job_sage2_polygon_winddirection.fgmj',
        'prometheus_job_sage3_divide_compass.fgmj',
      ]) {
        const plans = planFgmjImport(fixture(f));
        expect(plans.length, f).toBeGreaterThan(0);
        for (const plan of plans) {
          expect(plan.weather.length, `${f} / ${plan.scenarioName}`).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('filter kinds are honoured, not lumped together', () => {
    const SAGE1 = 'prometheus_job_sage1_patches_multiignition.fgmj';

    it('applies the landscape weather patch and nothing else', () => {
      const [best] = planFgmjImport(fixture(SAGE1));

      // The scenario names three filters of three different kinds.
      expect(best.appliedPatches).toEqual(['wthrptch10 augmented for Sage']);
    });

    it('notifies about a fuel patch and does not apply it', () => {
      const [best] = planFgmjImport(fixture(SAGE1));

      expect(best.skippedFuelPatches).toEqual(['all fuel to c2']);
      expect(best.warnings.join(' ')).toMatch(/all fuel to c2/);
      expect(best.warnings.join(' ')).toMatch(/fuel/i);
    });

    it('treats both fuel-patch kinds the same way', () => {
      // polyReplace and replace are both fuel patches.
      const plans = planFgmjImport(fixture(SAGE1));
      const threeDay = plans[2];

      expect(threeDay.skippedFuelPatches).toEqual(['all fuel to c2', 'Landscape Fuel Patch ']);
    });

    it('blocks on a polygon weather patch instead of applying it globally', () => {
      const [best] = planFgmjImport(fixture(SAGE1));

      expect(best.polygonPatches).toEqual(['Weather Poly Patch for Sage']);
      expect(best.blockers).toContain('polygonWeatherPatch');
      expect(best.blockerDetail.join(' ')).toMatch(/polygon/i);
      expect(best.blockerDetail.join(' ')).toMatch(/global|ignore/i);
    });

    it('does not let a skipped patch alter the weather', () => {
      const plans = planFgmjImport(fixture(SAGE1));
      const threeDay = plans[2];

      // Only wthrptch11 applied: RH down five, temperature up five.
      expect(threeDay.appliedPatches).toEqual(['wthrptch11']);
    });
  });
});
