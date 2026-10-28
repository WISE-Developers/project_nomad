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

/**
 * Explicit colours and sizes. The class names below have no stylesheet behind
 * them in this panel, so anything left to CSS renders with the browser default
 * — which is how the first build shipped grey-on-white text, black bars, and a
 * CDF line with `strokeWidth` but no `stroke`, i.e. invisible. Seen only by
 * opening it; every test was green.
 */
const INK = '#1f2933';
const MUTED = '#52606d';
const BAR = '#c2410c';
const LINE = '#0b6bcb';
const GRID = '#cbd2d9';

const fmtHa = (v: number): string =>
  v >= 1000 ? Math.round(v).toLocaleString('en-CA') : v.toFixed(v < 10 ? 1 : 0);

export function FireSizeDistribution({ resolution }: Props) {
  const { hasEnsemble, series, reason } = resolution;
  const [dayIndex, setDayIndex] = useState(0);

  // No ensemble is a statement, not an empty chart.
  if (!hasEnsemble || !series || series.days.length === 0) {
    return (
      <section className="fire-size-distribution">
        <h3>Fire size across scenarios</h3>
        <p className="fire-size-distribution__empty">
          {reason ?? 'No fire-size ensemble is available for this model.'}
        </p>
      </section>
    );
  }

  const day: FireSizeDay = series.days[Math.min(dayIndex, series.days.length - 1)];
  const { summary } = day;

  return (
    <section className="fire-size-distribution" style={{ color: INK, padding: '8px 4px' }}>
      <h3 style={{ color: INK, margin: '4px 0' }}>Fire size across scenarios</h3>

      <p className="fire-size-distribution__n" data-testid="fire-size-n" style={{ color: INK, margin: '2px 0' }}>
        {/* "scenarios", not "simulations": #429 established a row is one
            scenario's size at that save time, and the log's simulation count is
            a different number (six simulations, two rows). */}
        <strong>{summary.n}</strong> {summary.n === 1 ? 'scenario' : 'scenarios'}
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
          The scenario population changed between forecast days, so day-over-day
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
      <WithheldNote summary={summary} />

      {summary.n === 1 ? (
        <p className="fire-size-distribution__single" data-testid="fire-size-single">
          A single scenario, so <strong>no distribution</strong> exists for this run —
          one outcome of {fmtHa(summary.minHa)} ha, not a range.
        </p>
      ) : summary.degenerate ? (
        <p className="fire-size-distribution__single" data-testid="fire-size-degenerate">
          Every scenario produced the same size, {fmtHa(summary.minHa)} ha, so there is
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

/**
 * #429 IS ANSWERED, so the median and percentiles are shown — nearest-rank.
 *
 * Each row of sizes_*.csv is one SCENARIO's fire size at that save time, and the
 * file is the complete set of what reported in. Median and p50/p90/p95 follow
 * FireSTARR's own definition (`Statistics.h`): nearest-rank with no
 * interpolation, so every figure here is a size the ensemble actually produced,
 * and for an even N the median is the UPPER of the two middle values. That
 * agrees with the median `firestarr.log` prints and with FireGUARD's
 * Min/Average/Median/Max table (McFayden et al. 2025, Fig. 5), where a
 * conventional median would have disagreed with both.
 *
 * BELOW N=11 they are WITHHELD WITH A REASON rather than hidden: the same
 * formulas put p90 and p95 on one index for N<=10 and make the median equal the
 * maximum at N<=2, so the labels would print over a single value.
 *
 * N is labelled "Scenarios", not "Simulations": the log's simulation count is a
 * different number — a run logging six simulations writes two rows.
 */
function Statistics({ summary }: { summary: FireSizeDay['summary'] }) {
  return (
    <table
      className="fire-size-distribution__stats"
      style={{ color: INK, borderCollapse: 'collapse', margin: '6px 0' }}
    >
      <tbody>
        <tr>
          <th scope="row" style={{ textAlign: 'right', paddingRight: 8, color: MUTED }}>
            Scenarios (N)
          </th>
          <td data-testid="stat-n">{summary.n}</td>
        </tr>
        <tr>
          <th scope="row">Minimum</th>
          <td data-testid="stat-minHa">{fmtHa(summary.minHa)} ha</td>
        </tr>
        <tr>
          <th scope="row">Mean</th>
          <td data-testid="stat-meanHa">{fmtHa(summary.meanHa)} ha</td>
        </tr>
        {summary.percentileStats.kind === 'available' && (
          <>
            <tr>
              <th scope="row">Median</th>
              <td data-testid="stat-medianHa">
                {fmtHa(summary.percentileStats.medianHa)} ha
              </td>
            </tr>
            <tr>
              <th scope="row">90th percentile</th>
              <td data-testid="stat-p90Ha">
                {fmtHa(summary.percentileStats.percentilesHa[90])} ha
              </td>
            </tr>
            <tr>
              <th scope="row">95th percentile</th>
              <td data-testid="stat-p95Ha">
                {fmtHa(summary.percentileStats.percentilesHa[95])} ha
              </td>
            </tr>
          </>
        )}
        <tr>
          <th scope="row">Maximum</th>
          <td data-testid="stat-maxHa">{fmtHa(summary.maxHa)} ha</td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * The withheld case, STATED rather than silent. #419 requires a small ensemble
 * to "explicitly state that no distribution exists" — an omitted row states
 * nothing, and a reader cannot tell a thin ensemble from a broken backend.
 */
function WithheldNote({ summary }: { summary: FireSizeDay['summary'] }) {
  if (summary.percentileStats.kind !== 'withheld') return null;
  return (
    <p
      className="fire-size-distribution__withheld"
      data-testid="fire-size-withheld"
      style={{ color: MUTED, fontSize: 12, margin: '2px 0' }}
    >
      No median or percentile for this day: {summary.percentileStats.n}{' '}
      {summary.percentileStats.n === 1 ? 'scenario' : 'scenarios'} reported, and below 11
      the 90th and 95th percentiles land on the same value. Minimum, mean and maximum
      describe what was recorded.
    </p>
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
      <figcaption style={{ color: MUTED, fontSize: 12 }}>
        How many scenarios ended in each size range — {fmtHa(bins[0].fromHa)} to{' '}
        {fmtHa(bins[bins.length - 1].toHa)} ha
      </figcaption>
      <svg
        data-testid="histogram"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Histogram of final fire size across ${sizesHa.length} scenarios`}
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
              fill={BAR}
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
      <figcaption style={{ color: MUTED, fontSize: 12 }}>
        Proportion of scenarios at or below a given size — {fmtHa(min)} to {fmtHa(max)} ha
      </figcaption>
      <svg
        data-testid="ecdf"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Empirical cumulative distribution of final fire size"
      >
        {/* `stroke` is REQUIRED: strokeWidth alone defaults to stroke:none and
            draws an invisible line, which is exactly what shipped first. */}
        <path d={path} fill="none" stroke={LINE} strokeWidth={1.5} />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={GRID} strokeWidth={1} />
      </svg>
    </figure>
  );
}
