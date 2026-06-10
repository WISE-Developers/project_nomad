/**
 * palettes — the single source of truth for map legend colours, derived from
 * the vendored FireSTARR SLD (via sldPalette). Issue #283 Unit 2.
 *
 * This module exists to KILL the three hand-copied burn-probability ramps that
 * had drifted apart:
 *   - RasterLegend.tsx        PROBABILITY_LEGEND (10-class RYG, green low)
 *   - MapCapture.tsx          PROB_LEGEND       (identical copy)
 *   - OutputPreviewModal.tsx  inline 5-class pure-RGB ramp (#ff0000..#00ff00)
 * None matched the engine SLD; the green/`1-10%` low class is the #270 bug.
 *
 * Contract (Papa's decisions 2026-06-10): 10 SLD classes, displayed high->low,
 * blue low (#00b1f2) -> red high (#e6151f); PERCENT labels (0-10% .. >90%).
 */

import { describe, it, expect } from 'vitest';
import { PROBABILITY_LEGEND, toPercentLabel } from '../palettes';
import { parseProbabilitySld } from '../sldPalette';
import VENDORED_SLD from '../probability_processing.sld?raw';
// Raw sources of the three former copies, to prove the duplication is gone.
import rasterLegendSrc from '../../components/RasterLegend.tsx?raw';
import mapCaptureSrc from '../../components/MapCapture.tsx?raw';
import previewSrc from '../../../ModelReview/components/OutputPreviewModal.tsx?raw';

const EXPECTED_LABELS = [
  '>90%',
  '80-90%',
  '70-80%',
  '60-70%',
  '50-60%',
  '40-50%',
  '30-40%',
  '20-30%',
  '10-20%',
  '0-10%',
];
const EXPECTED_COLORS = [
  '#e6151f',
  '#eb3326',
  '#ee4f2c',
  '#f06c33',
  '#f28938',
  '#f5a23d',
  '#fac044',
  '#fcdf4b',
  '#faf68e',
  '#00b1f2',
];

describe('PROBABILITY_LEGEND', () => {
  it('has the 10 SLD ramp classes, displayed high -> low', () => {
    expect(PROBABILITY_LEGEND).toHaveLength(10);
    expect(PROBABILITY_LEGEND[0]).toEqual({ label: '>90%', color: '#e6151f' });
    expect(PROBABILITY_LEGEND[9]).toEqual({ label: '0-10%', color: '#00b1f2' });
  });

  it('renders percent labels low-inclusive to 0% (fixes #270 trim)', () => {
    expect(PROBABILITY_LEGEND.map((e) => e.label)).toEqual(EXPECTED_LABELS);
  });

  it('uses the exact SLD hexes, blue low -> red high', () => {
    expect(PROBABILITY_LEGEND.map((e) => e.color)).toEqual(EXPECTED_COLORS);
  });

  it('is sourced from the SLD: colours equal reversed sldPalette ramp', () => {
    const ramp = parseProbabilitySld(VENDORED_SLD).rampClasses.map((c) => c.color);
    expect(PROBABILITY_LEGEND.map((e) => e.color)).toEqual([...ramp].reverse());
  });

  it('drops the old spurious green low class entirely', () => {
    const colors = PROBABILITY_LEGEND.map((e) => e.color);
    expect(colors).not.toContain('rgb(76, 175, 80)');
    expect(colors).not.toContain('#4caf50');
  });
});

describe('toPercentLabel', () => {
  it('converts an SLD fraction range to a percent range', () => {
    expect(toPercentLabel('0.0 - 0.1')).toBe('0-10%');
    expect(toPercentLabel('0.8 - 0.9')).toBe('80-90%');
  });

  it('converts the open-ended high class', () => {
    expect(toPercentLabel('> 0.9')).toBe('>90%');
  });
});

describe('duplication is eliminated (3x copies removed)', () => {
  it('RasterLegend no longer declares its own PROBABILITY_LEGEND array', () => {
    expect(rasterLegendSrc).not.toMatch(/const PROBABILITY_LEGEND[^=]*=\s*\[/);
    expect(rasterLegendSrc).toMatch(/from ['"][^'"]*palettes(\.js)?['"]/);
  });

  it('MapCapture no longer declares PROB_LEGEND and imports the shared module', () => {
    expect(mapCaptureSrc).not.toMatch(/const PROB_LEGEND\s*=/);
    expect(mapCaptureSrc).not.toMatch(/rgb\(76, 175, 80\)/);
    expect(mapCaptureSrc).toMatch(/from ['"][^'"]*palettes(\.js)?['"]/);
  });

  it('OutputPreviewModal drops its inline RGB ramp and imports the shared module', () => {
    expect(previewSrc).not.toMatch(/#00ff00/i);
    expect(previewSrc).toMatch(/from ['"][^'"]*palettes(\.js)?['"]/);
  });
});
