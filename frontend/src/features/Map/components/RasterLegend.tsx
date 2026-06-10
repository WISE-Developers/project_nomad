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
import { generateArrivalLegend } from '../utils/arrivalTimeSymbolization.js';
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

// =============================================================================
// Probability Legend Block
// =============================================================================

function ProbabilityLegendBlock() {
  return (
    <>
      <div style={titleStyle}>Burn Probability</div>
      {PROBABILITY_LEGEND.map(({ label, color }) => (
        <div key={label} style={rowStyle}>
          <div
            data-testid="legend-swatch"
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
}

function ArrivalLegendBlock({
  layerId,
  meta,
  onTimestepChange,
}: ArrivalLegendBlockProps) {
  const entries = generateArrivalLegend({
    startJulian: meta.startJulian,
    endJulian: meta.endJulian,
    timestep: meta.timestep,
    startDate: new Date(meta.startDate),
  });
  return (
    <>
      <div style={titleStyle}>Fire Arrival Time</div>
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
      {entries.map((entry) => (
        <div key={entry.bucket} style={rowStyle}>
          <div
            data-testid="legend-swatch"
            style={{ ...swatchStyle, backgroundColor: entry.color }}
          />
          <span style={labelStyle}>{entry.label}</span>
        </div>
      ))}
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

  const handleTimestepChange = (layerId: string, next: ArrivalTimestep) => {
    const target = state.layers.find((l) => l.id === layerId) as RasterLayerConfig | undefined;
    if (!target?.arrivalMeta) return;
    updateLayer(layerId, {
      arrivalMeta: { ...target.arrivalMeta, timestep: next },
    } as Partial<RasterLayerConfig>);
  };

  const arrivalLayers = visibleRasters.filter(
    (l) => l.legendType === 'arrival' && l.arrivalMeta,
  );
  const hasProbability = visibleRasters.some((l) => l.legendType !== 'arrival');

  return (
    <aside role="complementary" style={containerStyle}>
      {hasProbability && <ProbabilityLegendBlock />}
      {arrivalLayers.map((layer) => (
        <div key={layer.id} style={{ marginTop: hasProbability ? '12px' : 0 }}>
          <ArrivalLegendBlock
            layerId={layer.id}
            meta={layer.arrivalMeta!}
            onTimestepChange={handleTimestepChange}
          />
        </div>
      ))}
    </aside>
  );
}
