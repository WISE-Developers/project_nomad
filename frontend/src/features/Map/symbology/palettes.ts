/**
 * palettes — the single source of truth for map legend colours.
 *
 * Issue #283 Unit 2. The burn-probability ramp had been hand-copied into three
 * files (RasterLegend, MapCapture, OutputPreviewModal) and had drifted apart;
 * none matched the engine's authoritative symbology. This module derives the
 * probability legend from the vendored FireSTARR SLD (via {@link parseProbabilitySld})
 * so every legend renders the identical, engine-correct ramp.
 *
 * Probability legend is NOT user-customizable (locked to the SLD); only the
 * deterministic/arrival legend is customizable (see #271, later units).
 *
 * Fail-fast: the SLD is parsed at module load — a missing/malformed SLD throws
 * here, surfacing loudly at startup rather than rendering a silent wrong ramp.
 */

import { parseProbabilitySld } from './sldPalette.js';
import sldRaw from './probability_processing.sld?raw';

/** A single legend row: a text label and its swatch colour. */
export interface LegendEntry {
  label: string;
  color: string;
}

/** Parsed, SLD-sourced probability palette (throws at import if SLD is bad). */
export const probabilityPalette = parseProbabilitySld(sldRaw);

/**
 * Convert an SLD fraction-range label to a percent label.
 *   "0.0 - 0.1" -> "0-10%",  "0.8 - 0.9" -> "80-90%",  "> 0.9" -> ">90%"
 */
export function toPercentLabel(sldLabel: string): string {
  const pct = (sldLabel.match(/[\d.]+/g) ?? []).map((n) => Math.round(Number(n) * 100));
  if (sldLabel.trim().startsWith('>')) return `>${pct[0]}%`;
  if (pct.length >= 2) return `${pct[0]}-${pct[1]}%`;
  return `${pct[0] ?? 0}%`;
}

/**
 * The burn-probability legend: the 10 SLD ramp classes displayed high -> low
 * (red high #e6151f -> blue low #00b1f2), with percent labels. The low class is
 * the engine's `0.0 - 0.1` blue class — including it fixes the #270 0% trim.
 */
export const PROBABILITY_LEGEND: LegendEntry[] = [...probabilityPalette.rampClasses]
  .reverse()
  .map((c) => ({ label: toPercentLabel(c.label), color: c.color }));
