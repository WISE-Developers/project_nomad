/**
 * The ensemble fire-size distribution (#419).
 *
 * Burn probability answers "will this pixel burn". Fire managers resource per
 * FIRE, and fire size is what drives fireline effort, crews and logistics — so
 * this answers the question a BP raster cannot: are most simulations producing
 * small fires, or is there meaningful large-incident potential?
 *
 * Drawn as inline SVG rather than with a charting library: this panel ships
 * inside openNomad as an embedded component, and a chart dependency there is a
 * cost paid by every host application.
 */

import { useMemo, useState } from 'react';
import { ecdfPoints, histogramBins } from '../utils/fireSizeDistribution';
import type { FireSizeResolution, FireSizeDay } from '../types/fireSizes';

interface Props {
  resolution: FireSizeResolution;
}

const fmtHa = (v: number): string =>
  v >= 1000 ? Math.round(v).toLocaleString('en-CA') : v.toFixed(v < 10 ? 1 : 0);

export function FireSizeDistribution({ resolution }: Props) {
  const { hasEnsemble, series, reason } = resolution;
  const [dayIndex, setDayIndex] = useState(0);

  // No ensemble is a statement, not an empty chart.
  if (!hasEnsemble || !series || series.days.length === 0) {
    return (
      <section className="fire-size-distribution">
        <h3>Fire size across simulations</h3>
        <p className="fire-size-distribution__empty">
          {reason ?? 'No fire-size ensemble is available for this model.'}
        </p>
      </section>
    );
  }

  const day: FireSizeDay = series.days[Math.min(dayIndex, series.days.length - 1)];
  const { summary } = day;

  return (
    <section className="fire-size-distribution">
      <h3>Fire size across simulations</h3>

      <p className="fire-size-distribution__n" data-testid="fire-size-n">
        <strong>{summary.n}</strong> {summary.n === 1 ? 'simulation' : 'simulations'}
        {day.date ? ` — ${day.date}` : ` — day ${day.julianDay}`}
      </p>

      {series.days.length > 1 && (
        <label className="fire-size-distribution__day-picker">
          Forecast day{' '}
          <select
            value={dayIndex}
            onChange={e => setDayIndex(Number(e.target.value))}
            aria-label="Forecast day"
          >
            {series.days.map((d, i) => (
              <option key={d.julianDay} value={i}>
                {d.date ?? `Day ${d.julianDay}`}
              </option>
            ))}
          </select>
        </label>
      )}

      {!series.nConstantAcrossDays && (
        <p className="fire-size-distribution__warning">
          The simulation population changed between forecast days, so day-over-day
          comparison is not reliable for this run.
        </p>
      )}

      {(series.reducedPrecision || day.reducedPrecision) && (
        <p className="fire-size-distribution__warning">
          Sizes above one million hectares are recorded to six significant figures, so
          these values carry reduced precision.
        </p>
      )}

      <Statistics summary={summary} />

      {summary.n === 1 ? (
        <p className="fire-size-distribution__single" data-testid="fire-size-single">
          A single simulation, so <strong>no distribution</strong> exists for this run —
          one outcome of {fmtHa(summary.minHa)} ha, not a range.
        </p>
      ) : summary.degenerate ? (
        <p className="fire-size-distribution__single" data-testid="fire-size-degenerate">
          Every simulation produced the same size, {fmtHa(summary.minHa)} ha, so there is
          no spread to plot.
        </p>
      ) : (
        <>
          <Histogram sizesHa={day.sizesHa} />
          <Ecdf sizesHa={day.sizesHa} />
        </>
      )}
    </section>
  );
}

function Statistics({ summary }: { summary: FireSizeDay['summary'] }) {
  const percentiles = Object.keys(summary.percentilesHa)
    .map(Number)
    .sort((a, b) => a - b);
  return (
    <table className="fire-size-distribution__stats">
      <tbody>
        <tr>
          <th scope="row">Simulations (N)</th>
          <td data-testid="stat-n">{summary.n}</td>
        </tr>
        <tr>
          <th scope="row">Minimum</th>
          <td data-testid="stat-minHa">{fmtHa(summary.minHa)} ha</td>
        </tr>
        <tr>
          <th scope="row">Median</th>
          <td data-testid="stat-medianHa">{fmtHa(summary.medianHa)} ha</td>
        </tr>
        <tr>
          <th scope="row">Mean</th>
          <td data-testid="stat-meanHa">{fmtHa(summary.meanHa)} ha</td>
        </tr>
        {percentiles
          .filter(p => p !== 50)
          .map(p => (
            <tr key={p}>
              <th scope="row">{`p${p}`}</th>
              <td data-testid={`stat-p${p}`}>{fmtHa(summary.percentilesHa[p])} ha</td>
            </tr>
          ))}
        <tr>
          <th scope="row">Maximum</th>
          <td data-testid="stat-maxHa">{fmtHa(summary.maxHa)} ha</td>
        </tr>
      </tbody>
    </table>
  );
}

const W = 320;
const H = 120;
const PAD = 4;

function Histogram({ sizesHa }: { sizesHa: number[] }) {
  const bins = useMemo(() => histogramBins(sizesHa), [sizesHa]);
  const peak = Math.max(...bins.map(b => b.count), 1);
  const barWidth = (W - PAD * 2) / bins.length;
  return (
    <figure className="fire-size-distribution__chart">
      <figcaption>How many simulations ended in each size range</figcaption>
      <svg
        data-testid="histogram"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Histogram of final fire size across ${sizesHa.length} simulations`}
      >
        {bins.map((b, i) => {
          const h = (b.count / peak) * (H - PAD * 2);
          return (
            <rect
              key={i}
              x={PAD + i * barWidth}
              y={H - PAD - h}
              width={Math.max(1, barWidth - 1)}
              height={h}
            >
              <title>{`${fmtHa(b.fromHa)}–${fmtHa(b.toHa)} ha: ${b.count}`}</title>
            </rect>
          );
        })}
      </svg>
    </figure>
  );
}

function Ecdf({ sizesHa }: { sizesHa: number[] }) {
  const points = useMemo(() => ecdfPoints(sizesHa), [sizesHa]);
  const min = points[0]?.sizeHa ?? 0;
  const max = points[points.length - 1]?.sizeHa ?? 1;
  const span = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = PAD + ((p.sizeHa - min) / span) * (W - PAD * 2);
      const y = H - PAD - p.proportion * (H - PAD * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <figure className="fire-size-distribution__chart">
      <figcaption>
        Proportion of simulations at or below a given size
      </figcaption>
      <svg
        data-testid="ecdf"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Empirical cumulative distribution of final fire size"
      >
        <path d={path} fill="none" strokeWidth={1.5} />
      </svg>
    </figure>
  );
}
