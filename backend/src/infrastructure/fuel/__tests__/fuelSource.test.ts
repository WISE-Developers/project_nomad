import { describe, it, expect } from 'vitest';
import { resolveFuelSource, fuelProducerLabel } from '../fuelSource';

/**
 * #282 task 6 — the WCS as a SELECTABLE source. Condition 5.
 *
 * The rule that shapes every test here: an installation that has local fuel
 * tiles must keep working untouched, and an installation that asks for the WCS
 * and is misconfigured must FAIL rather than quietly use something else. A
 * fallback between fuel sources would mean a fire model running on a grid
 * nobody chose, and nothing in the output would say so.
 */
const WCS_ENV = {
  NOMAD_FUEL_SOURCE: 'wcs',
  NOMAD_FUEL_WCS_URL: 'https://ca.nfis.org/mapserver/cgi-bin/fbp_eng.cgi',
  NOMAD_FUEL_WCS_COVERAGE: 'fbp100m2026wcs',
  NOMAD_FUEL_WCS_CACHE_DIR: '/data/fuel-cache',
};

describe('resolveFuelSource', () => {
  it('defaults to local when nothing is set, so existing installs are untouched', () => {
    // The backward-compatibility guarantee, and the most important test in this
    // file: every deployment in the field today sets none of these variables.
    expect(resolveFuelSource({})).toEqual({ kind: 'local' });
  });

  it('accepts local explicitly', () => {
    expect(resolveFuelSource({ NOMAD_FUEL_SOURCE: 'local' })).toEqual({ kind: 'local' });
  });

  it('resolves a fully configured WCS source', () => {
    expect(resolveFuelSource(WCS_ENV)).toEqual({
      kind: 'wcs',
      baseUrl: 'https://ca.nfis.org/mapserver/cgi-bin/fbp_eng.cgi',
      coverageId: 'fbp100m2026wcs',
      cacheDir: '/data/fuel-cache',
    });
  });

  it('is case and whitespace tolerant on the selector only', () => {
    expect(resolveFuelSource({ ...WCS_ENV, NOMAD_FUEL_SOURCE: '  WCS ' }).kind).toBe('wcs');
    expect(resolveFuelSource({ NOMAD_FUEL_SOURCE: 'LOCAL' })).toEqual({ kind: 'local' });
  });

  it('FAILS, never falls back to local, when the WCS is asked for and misconfigured', () => {
    // Each variable individually. A fallback here is the whole danger: the run
    // would succeed on local tiles while the operator believes it used the WCS.
    for (const missing of [
      'NOMAD_FUEL_WCS_URL',
      'NOMAD_FUEL_WCS_COVERAGE',
      'NOMAD_FUEL_WCS_CACHE_DIR',
    ]) {
      const env = { ...WCS_ENV, [missing]: undefined };
      expect(() => resolveFuelSource(env), missing).toThrow(new RegExp(missing));
      // And it must not have quietly produced a local source instead.
      expect(() => resolveFuelSource(env), missing).toThrow(/fuel source/i);
    }
  });

  it('treats an empty string as missing, not as configured', () => {
    // `NOMAD_FUEL_WCS_URL=` in an env file is the easiest way to look configured
    // and be empty.
    expect(() => resolveFuelSource({ ...WCS_ENV, NOMAD_FUEL_WCS_URL: '   ' })).toThrow(
      /NOMAD_FUEL_WCS_URL/,
    );
  });

  it('REFUSES an unrecognised selector rather than defaulting to local', () => {
    // A typo must not silently become the old behaviour: the operator asked for
    // something and would be told nothing.
    expect(() => resolveFuelSource({ NOMAD_FUEL_SOURCE: 'wsc' })).toThrow(/wsc/);
    expect(() => resolveFuelSource({ NOMAD_FUEL_SOURCE: 'remote' })).toThrow(/remote/);
  });
});

describe('fuelProducerLabel', () => {
  it('names the WCS and its coverage, so a run records which source it used', () => {
    // #431 already records WHO produced the fuel a run consumed. This is what
    // goes in that field when the fuel came from the service.
    const label = fuelProducerLabel(resolveFuelSource(WCS_ENV));
    expect(label).toMatch(/fbp100m2026wcs/);
    expect(label).toMatch(/WCS/i);
  });

  it('does not claim the WCS for a local run', () => {
    // The discriminating half: a label that always mentioned the WCS would
    // satisfy the test above and misattribute every local run.
    const label = fuelProducerLabel(resolveFuelSource({}));
    expect(label).not.toMatch(/wcs/i);
    expect(label).toMatch(/local/i);
  });
});
