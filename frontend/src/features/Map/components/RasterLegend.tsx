/**
 * RasterLegend — legend overlay for visible raster layers.
 *
 * Renders a semi-transparent legend in the bottom-right area of the map.
 * Supports two legend modes:
 *   - probability (default): FireSTARR 10-class burn-probability ramp, sourced
 *     from the vendored SLD via symbology/palettes (#283)
 *   - arrival: dynamic ramp driven by ArrivalRasterMeta (#226) with a user
 *     timestep toggle (daily / hourly) that re-symbolizes the layer in place.
 *
 * @module features/Map/components/RasterLegend
 */

import React from 'react';
import { useLayers } from '../context/LayerContext.js';
import type {
  ArrivalTimestep,
  ArrivalRasterMeta,
  RasterLayerConfig,
} from '../types/layer.js';
import {
  generateArrivalLegend,
  ARRIVAL_RAMP_PRESETS,
} from '../utils/arrivalTimeSymbolization.js';
import { PROBABILITY_LEGEND } from '../symbology/palettes.js';

// =============================================================================
// Probability Ramp — sourced from the vendored FireSTARR SLD (#283 Unit 2)
// =============================================================================

// =============================================================================
// Styles
// =============================================================================

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: '40px',
  right: '180px',
  backgroundColor: 'rgba(255, 255, 255, 0.85)',
  borderRadius: '4px',
  padding: '8px 12px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
  zIndex: 10,
  minWidth: '140px',
  maxHeight: '60vh',
  overflowY: 'auto',
};

const titleStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#333',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '4px',
};

const swatchStyle: React.CSSProperties = {
  width: '16px',
  height: '16px',
  borderRadius: '2px',
  border: '1px solid rgba(0,0,0,0.15)',
  flexShrink: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#444',
};

const toggleRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
  marginBottom: '6px',
};

const toggleButtonStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  fontSize: '11px',
  padding: '3px 6px',
  border: `1px solid ${active ? '#555' : '#ccc'}`,
  backgroundColor: active ? '#333' : '#fff',
  color: active ? '#fff' : '#333',
  borderRadius: '3px',
  cursor: 'pointer',
  fontWeight: active ? 600 : 400,
});

/**
 * Parse an uploaded colour-ramp file into ordered hex stops (#271 Unit 9).
 * Accepts a JSON array of hex strings, or whitespace/comma/newline-separated
 * `#rrggbb` tokens. Fail-fast: throws on anything malformed or with < 2 stops
 * — there is no silent fallback to a default ramp.
 */
export function parseRampStops(text: string): string[] {
  const trimmed = text.trim();
  let tokens: string[];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('Ramp JSON must be an array of hex colours');
    tokens = parsed.map(String);
  } else {
    tokens = trimmed.split(/[\s,]+/).filter(Boolean);
  }
  const stops = tokens.map((t) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(t.trim());
    if (!m) throw new Error(`Invalid colour "${t}" (expected #rrggbb)`);
    return `#${m[1].toLowerCase()}`;
  });
  if (stops.length < 2) throw new Error('A ramp needs at least two colour stops');
  return stops;
}

// =============================================================================
// Probability Legend Block
// =============================================================================

function ProbabilityLegendBlock() {
  return (
    <>
      <div style={titleStyle} role="heading" aria-level={3}>
        Burn Probability
      </div>
      {PROBABILITY_LEGEND.map(({ label, color }) => (
        <div key={label} style={rowStyle}>
          <div
            data-testid="legend-swatch"
            aria-hidden="true"
            style={{ ...swatchStyle, backgroundColor: color }}
          />
          <span style={labelStyle}>{label}</span>
        </div>
      ))}
    </>
  );
}

// =============================================================================
// Arrival Legend Block (#226)
// =============================================================================

interface ArrivalLegendBlockProps {
  layerId: string;
  meta: ArrivalRasterMeta;
  onTimestepChange: (layerId: string, next: ArrivalTimestep) => void;
  onBreaksChange: (layerId: string, breaksPerDay: number) => void;
  onRampChange: (layerId: string, ramp: string) => void;
  onCustomRamp: (layerId: string, file: File) => void;
  onDayRecolor: (layerId: string, dayIndex: number, hex: string) => void;
  onToggleHighlight: (layerId: string, bucket: number) => void;
  /** Shared earliest start day across all visible fires (#274 Unit 5). */
  originDay: number;
  /** Shared day span across all visible fires (#274 Unit 5). */
  totalDays: number;
}

/** Temporal breaks-per-day options for the hourly view (#271 Unit 8). */
const BREAKS_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Hourly', value: 24 },
  { label: '3-hourly', value: 8 },
  { label: '6-hourly', value: 4 },
];

function ArrivalLegendBlock({
  layerId,
  meta,
  onTimestepChange,
  onBreaksChange,
  onRampChange,
  onCustomRamp,
  onDayRecolor,
  onToggleHighlight,
  originDay,
  totalDays,
}: ArrivalLegendBlockProps) {
  const breaksPerDay = meta.breaksPerDay ?? 24;
  const activeRamp = meta.ramp ?? 'viridis';
  const highlightSet = new Set(meta.highlightBuckets ?? []);
  const hasHighlight = highlightSet.size > 0;
  const entries = generateArrivalLegend({
    startJulian: meta.startJulian,
    endJulian: meta.endJulian,
    timestep: meta.timestep,
    startDate: new Date(meta.startDate),
    originDay,
    totalDaysOverride: totalDays,
    breaksPerDay,
    ramp: meta.ramp,
    customStops: meta.customStops,
    dayColorOverrides: meta.dayColorOverrides,
  });
  return (
    <>
      <div style={titleStyle} role="heading" aria-level={3}>
        Fire Arrival Time
      </div>
      <div style={toggleRowStyle}>
        <button
          type="button"
          data-testid="arrival-timestep-daily"
          style={toggleButtonStyle(meta.timestep === 'daily')}
          onClick={() => onTimestepChange(layerId, 'daily')}
        >
          Daily
        </button>
        <button
          type="button"
          data-testid="arrival-timestep-hourly"
          style={toggleButtonStyle(meta.timestep === 'hourly')}
          onClick={() => onTimestepChange(layerId, 'hourly')}
        >
          Hourly
        </button>
      </div>
      {meta.timestep === 'hourly' && (
        <div style={toggleRowStyle} role="group" aria-label="Breaks per day">
          {BREAKS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid={`arrival-breaks-${opt.value}`}
              aria-pressed={breaksPerDay === opt.value}
              style={toggleButtonStyle(breaksPerDay === opt.value)}
              onClick={() => onBreaksChange(layerId, opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginBottom: '6px' }}>
        <label style={{ ...labelStyle, fontSize: '11px', display: 'block', marginBottom: '2px' }}>
          Colour ramp
          <select
            data-testid="arrival-ramp-select"
            aria-label="Arrival colour ramp"
            value={activeRamp}
            onChange={(e) => onRampChange(layerId, e.target.value)}
            style={{ width: '100%', fontSize: '11px', padding: '2px', marginTop: '2px' }}
          >
            {ARRIVAL_RAMP_PRESETS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
            {activeRamp === 'custom' && <option value="custom">custom (uploaded)</option>}
          </select>
        </label>
        <input
          type="file"
          accept=".txt,.csv,.json,text/plain"
          data-testid="arrival-ramp-upload"
          aria-label="Upload custom colour ramp"
          style={{ fontSize: '10px', marginTop: '2px', width: '100%' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onCustomRamp(layerId, file);
            e.target.value = '';
          }}
        />
      </div>
      {entries.map((entry) => {
        const highlighted = highlightSet.has(entry.bucket);
        return (
        <div
          key={entry.bucket}
          style={{ ...rowStyle, opacity: hasHighlight && !highlighted ? 0.4 : 1 }}
        >
          {meta.timestep === 'daily' ? (
            <input
              type="color"
              data-testid="legend-swatch"
              aria-label={`Recolour ${entry.label}`}
              title="Click to recolour this day"
              value={entry.color}
              onChange={(e) => onDayRecolor(layerId, entry.dayIndex, e.target.value)}
              style={{
                ...swatchStyle,
                padding: 0,
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
              }}
            />
          ) : (
            <div
              data-testid="legend-swatch"
              aria-hidden="true"
              style={{ ...swatchStyle, backgroundColor: entry.color }}
            />
          )}
          <button
            type="button"
            data-testid="legend-highlight"
            aria-pressed={highlighted}
            title="Click to highlight this band on the map"
            onClick={() => onToggleHighlight(layerId, entry.bucket)}
            style={{
              ...labelStyle,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
              fontWeight: highlighted ? 700 : 400,
            }}
          >
            {entry.label}
          </button>
        </div>
        );
      })}
    </>
  );
}

// =============================================================================
// Top-level Component
// =============================================================================

export function RasterLegend() {
  const { state, updateLayer } = useLayers();

  const visibleRasters = state.layers.filter(
    (layer) => layer.type === 'raster' && layer.visible,
  ) as RasterLayerConfig[];

  if (visibleRasters.length === 0) return null;

  // Bin indices mean different things per binning (daily vs hourly vs N-breaks),
  // so a highlight from one mode is meaningless in another — clear it on change
  // (#272), otherwise a stale index dims every band.
  const handleTimestepChange = (layerId: string, next: ArrivalTimestep) => {
    const target = state.layers.find((l) => l.id === layerId) as RasterLayerConfig | undefined;
    if (!target?.arrivalMeta) return;
    updateLayer(layerId, {
      arrivalMeta: { ...target.arrivalMeta, timestep: next, highlightBuckets: [] },
    } as Partial<RasterLayerConfig>);
  };

  const handleBreaksChange = (layerId: string, breaksPerDay: number) => {
    const target = state.layers.find((l) => l.id === layerId) as RasterLayerConfig | undefined;
    if (!target?.arrivalMeta) return;
    updateLayer(layerId, {
      arrivalMeta: { ...target.arrivalMeta, breaksPerDay, highlightBuckets: [] },
    } as Partial<RasterLayerConfig>);
  };

  const handleRampChange = (layerId: string, ramp: string) => {
    const target = state.layers.find((l) => l.id === layerId) as RasterLayerConfig | undefined;
    if (!target?.arrivalMeta) return;
    updateLayer(layerId, {
      arrivalMeta: { ...target.arrivalMeta, ramp },
    } as Partial<RasterLayerConfig>);
  };

  const handleDayRecolor = (layerId: string, dayIndex: number, hex: string) => {
    const target = state.layers.find((l) => l.id === layerId) as RasterLayerConfig | undefined;
    if (!target?.arrivalMeta) return;
    updateLayer(layerId, {
      arrivalMeta: {
        ...target.arrivalMeta,
        dayColorOverrides: { ...(target.arrivalMeta.dayColorOverrides ?? {}), [dayIndex]: hex },
      },
    } as Partial<RasterLayerConfig>);
  };

  const handleToggleHighlight = (layerId: string, bucket: number) => {
    const target = state.layers.find((l) => l.id === layerId) as RasterLayerConfig | undefined;
    if (!target?.arrivalMeta) return;
    const current = target.arrivalMeta.highlightBuckets ?? [];
    const next = current.includes(bucket)
      ? current.filter((b) => b !== bucket)
      : [...current, bucket];
    updateLayer(layerId, {
      arrivalMeta: { ...target.arrivalMeta, highlightBuckets: next },
    } as Partial<RasterLayerConfig>);
  };

  const handleCustomRamp = async (layerId: string, file: File) => {
    const target = state.layers.find((l) => l.id === layerId) as RasterLayerConfig | undefined;
    if (!target?.arrivalMeta) return;
    try {
      const stops = parseRampStops(await file.text());
      updateLayer(layerId, {
        arrivalMeta: { ...target.arrivalMeta, ramp: 'custom', customStops: stops },
      } as Partial<RasterLayerConfig>);
    } catch (err) {
      // Fail loudly — no silent fallback to a default ramp.
      // eslint-disable-next-line no-alert
      alert(`Could not load colour ramp: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const arrivalLayers = visibleRasters.filter(
    (l) => l.legendType === 'arrival' && l.arrivalMeta,
  );
  // Server-rendered legend images (CWFIS M3 layers #299)
  const wmsLayers = visibleRasters.filter(
    (l) => l.legendType === 'wms' && l.legendUrl,
  );
  // Probability = model-output rasters (and legacy CFS layers with no type),
  // but NOT arrival or wms layers.
  const hasProbability = visibleRasters.some(
    (l) => l.legendType !== 'arrival' && l.legendType !== 'wms',
  );

  // Align day colours across every visible fire to the earliest start day so
  // "day N" reads the same colour on all of them (#274 Unit 5, jordan-evens).
  const originDay = arrivalLayers.length
    ? Math.min(...arrivalLayers.map((l) => Math.floor(l.arrivalMeta!.startJulian)))
    : 0;
  const lastDay = arrivalLayers.length
    ? Math.max(...arrivalLayers.map((l) => Math.ceil(l.arrivalMeta!.endJulian)))
    : 1;
  const sharedTotalDays = Math.max(1, lastDay - originDay);

  return (
    <aside role="complementary" aria-label="Map legend" style={containerStyle}>
      {hasProbability && <ProbabilityLegendBlock />}
      {wmsLayers.map((layer, i) => (
        <div key={layer.id} style={{ marginTop: hasProbability || i > 0 ? '12px' : 0 }}>
          <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '4px', color: '#333' }}>
            {layer.name}
          </div>
          <img
            src={layer.legendUrl}
            alt={`${layer.name} legend`}
            style={{ display: 'block', maxWidth: '220px' }}
          />
        </div>
      ))}
      {arrivalLayers.map((layer) => (
        <div key={layer.id} style={{ marginTop: hasProbability ? '12px' : 0 }}>
          <ArrivalLegendBlock
            layerId={layer.id}
            meta={layer.arrivalMeta!}
            onTimestepChange={handleTimestepChange}
            onBreaksChange={handleBreaksChange}
            onRampChange={handleRampChange}
            onCustomRamp={handleCustomRamp}
            onDayRecolor={handleDayRecolor}
            onToggleHighlight={handleToggleHighlight}
            originDay={originDay}
            totalDays={sharedTotalDays}
          />
        </div>
      ))}
    </aside>
  );
}
