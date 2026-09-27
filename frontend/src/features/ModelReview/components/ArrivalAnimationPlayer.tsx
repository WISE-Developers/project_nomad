/**
 * ArrivalAnimationPlayer
 *
 * Slider + play/pause + time label that drives the map's per-frame filter
 * on the arrival-perimeter layer (refs #236). Stateless about MapLibre —
 * emits the current offsetHours through onFrameChange; the parent wires
 * that to the layer filter.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  computeAnimationBounds,
  formatLocalTime,
  getFrameIsoTime,
} from '../utils/arrivalAnimation.js';
import type { ArrivalPerimeterFeatureCollection } from '../utils/arrivalAnimation.js';

export interface ArrivalAnimationPlayerProps {
  data: ArrivalPerimeterFeatureCollection;
  onFrameChange: (offsetHours: number) => void;
  /** Milliseconds between auto-advance ticks when playing. Defaults to 200ms. */
  tickIntervalMs?: number;
  /**
   * IANA timezone to render the frame time in (e.g. 'America/Edmonton'). When
   * omitted, the browser's local timezone is used. Never rendered as UTC/Z.
   */
  timezone?: string;
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '12px',
  border: '1px solid #e0e0e0',
  borderRadius: '6px',
  background: '#fafafa',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
};

const playButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  border: '1px solid #2e86c1',
  background: '#2e86c1',
  color: 'white',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
  minWidth: '72px',
};

const sliderStyle: React.CSSProperties = {
  flex: 1,
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  color: '#333',
  minWidth: '220px',
};

export function ArrivalAnimationPlayer({
  data,
  onFrameChange,
  tickIntervalMs = 200,
  timezone,
}: ArrivalAnimationPlayerProps) {
  const bounds = useMemo(() => computeAnimationBounds(data), [data]);
  const [current, setCurrent] = useState<number>(bounds?.minOffset ?? 0);
  const [playing, setPlaying] = useState(false);

  // Re-anchor current if the dataset changes (e.g. different model).
  useEffect(() => {
    if (bounds) setCurrent(bounds.minOffset);
    // Depending on the two primitives rather than the `bounds` object is
    // deliberate and MORE stable, not less: `bounds` is a useMemo over `data`,
    // so it is a fresh object whenever `data` is, and depending on it would
    // re-anchor the playhead on renders where the actual frame range is
    // unchanged -- visibly yanking the animation back to its first frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds?.minOffset, bounds?.maxOffset]);

  // Emit the initial frame to the parent so the map reflects it immediately.
  useEffect(() => {
    if (bounds) onFrameChange(current);
    // onFrameChange intentionally NOT in deps — we only re-emit on current change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  useEffect(() => {
    if (!playing || !bounds) return;
    const id = setInterval(() => {
      setCurrent((c) => {
        const next = c + 1;
        if (next > bounds.maxOffset) {
          setPlaying(false);
          return bounds.maxOffset;
        }
        return next;
      });
    }, tickIntervalMs);
    return () => clearInterval(id);
    // Same reason as the re-anchor effect above: the primitives are the stable
    // dependency. Depending on the `bounds` object would tear down and restart
    // the playback interval on unrelated re-renders, dropping frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, bounds?.minOffset, bounds?.maxOffset, tickIntervalMs]);

  if (!bounds) {
    return (
      <div style={containerStyle}>
        <div style={labelStyle}>No animation frames available.</div>
      </div>
    );
  }

  const isoTime = getFrameIsoTime(data, current);
  const displayTime = isoTime ? formatLocalTime(isoTime, timezone) : '—';
  const atEnd = !playing && current >= bounds.maxOffset;
  const buttonLabel = playing ? 'Pause' : atEnd ? 'Replay' : 'Play';
  const buttonAriaLabel = playing
    ? 'Pause animation'
    : atEnd
      ? 'Replay animation'
      : 'Play animation';

  const handlePlayPause = () => {
    if (atEnd) {
      setCurrent(bounds.minOffset);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  };

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <button
          type="button"
          style={playButtonStyle}
          aria-label={buttonAriaLabel}
          onClick={handlePlayPause}
        >
          {buttonLabel}
        </button>
        <input
          type="range"
          min={bounds.minOffset}
          max={bounds.maxOffset}
          step={1}
          value={current}
          onChange={(e) => setCurrent(Number(e.target.value))}
          aria-label="Animation frame"
          style={sliderStyle}
        />
      </div>
      <div style={labelStyle}>
        Hour {current} / {bounds.maxOffset} — {displayTime}
      </div>
    </div>
  );
}
