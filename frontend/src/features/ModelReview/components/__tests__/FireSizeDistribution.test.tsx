import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FireSizeDistribution } from '../FireSizeDistribution';
import type { FireSizeSeries } from '../../types/fireSizes';

function day(sizesHa: number[], julianDay = 176, date = '2023-06-25') {
  const sorted = [...sizesHa].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    julianDay,
    date,
    sizesHa,
    reducedPrecision: false,
    summary: {
      n,
      minHa: sorted[0],
      maxHa: sorted[n - 1],
      meanHa: mean,
      medianHa: median,
      percentilesHa: { 50: median, 90: sorted[n - 1], 95: sorted[n - 1] },
      degenerate: sorted[0] === sorted[n - 1],
    },
  };
}

const series = (days: ReturnType<typeof day>[]): FireSizeSeries => ({
  days,
  n: Math.max(...days.map(d => d.summary.n)),
  nConstantAcrossDays: new Set(days.map(d => d.summary.n)).size <= 1,
  reducedPrecision: days.some(d => d.reducedPrecision),
});

describe('FireSizeDistribution', () => {
  it('states N on the product, always', () => {
    render(<FireSizeDistribution resolution={{ hasEnsemble: true, series: series([day([209352, 227341])]), reason: null }} />);
    // Queried by test id, not by /simulations/i, which also matches the heading.
    expect(screen.getByTestId('stat-n').textContent).toBe('2');
    expect(screen.getByTestId('fire-size-n').textContent).toMatch(/2 simulations/);
    expect(screen.getByTestId('fire-size-n').textContent).toMatch(/2023-06-25/);
  });

  it('shows the median and the percentiles a resourcing decision needs', () => {
    render(<FireSizeDistribution resolution={{ hasEnsemble: true, series: series([day([100, 200, 300])]), reason: null }} />);
    expect(screen.getByTestId('stat-medianHa').textContent).toMatch(/200/);
    expect(screen.getByTestId('stat-p90')).toBeTruthy();
    expect(screen.getByTestId('stat-maxHa').textContent).toMatch(/300/);
  });

  it('says plainly that no distribution exists when N is 1, and still shows the value', () => {
    render(<FireSizeDistribution resolution={{ hasEnsemble: true, series: series([day([4210])]), reason: null }} />);
    // The value must appear in the SENTENCE, not only in the stats table —
    // "4210" alone matches four stat cells and would pass without the message.
    // getByText returns the INNERMOST match, which was the <strong> alone.
    const single = screen.getByTestId('fire-size-single');
    expect(single.textContent).toMatch(/no distribution/i);
    expect(single.textContent).toMatch(/4,?210\s*ha/);
    expect(single.textContent).toMatch(/not a range/i);
    // A one-sample histogram would be a lie about the ensemble.
    expect(screen.queryByTestId('histogram')).toBeNull();
  });

  it('labels a degenerate ensemble instead of drawing a spread', () => {
    render(<FireSizeDistribution resolution={{ hasEnsemble: true, series: series([day([186994, 186994])]), reason: null }} />);
    expect(screen.getByText(/every simulation/i)).toBeTruthy();
  });

  it('renders the histogram and the CDF when there is a real spread', () => {
    render(<FireSizeDistribution resolution={{ hasEnsemble: true, series: series([day([1, 50, 120, 400, 900])]), reason: null }} />);
    expect(screen.getByTestId('histogram')).toBeTruthy();
    expect(screen.getByTestId('ecdf')).toBeTruthy();
  });

  it('shows the reason, not an empty chart, when no ensemble was recorded', () => {
    render(
      <FireSizeDistribution
        resolution={{ hasEnsemble: false, series: null, reason: 'this run recorded no fire-size files, so it has no ensemble to summarise' }}
      />,
    );
    expect(screen.getByText(/recorded no fire-size files/i)).toBeTruthy();
    expect(screen.queryByTestId('histogram')).toBeNull();
  });

  it('warns when the row count changed between days, because the population moved', () => {
    const s = series([day([1, 2], 170, '2023-06-19'), day([1, 2, 3], 171, '2023-06-20')]);
    render(<FireSizeDistribution resolution={{ hasEnsemble: true, series: s, reason: null }} />);
    expect(screen.getByText(/population/i)).toBeTruthy();
  });

  it('warns when values were written in reduced precision', () => {
    const d = day([1642880, 1642880]);
    d.reducedPrecision = true;
    render(<FireSizeDistribution resolution={{ hasEnsemble: true, series: series([d]), reason: null }} />);
    expect(screen.getByText(/precision/i)).toBeTruthy();
  });
});
