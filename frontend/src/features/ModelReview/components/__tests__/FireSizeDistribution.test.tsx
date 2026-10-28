import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FireSizeDistribution } from '../FireSizeDistribution';
import type { FireSizeSeries } from '../../types/fireSizes';

function day(sizesHa: number[], julianDay = 176, date = '2023-06-25') {
  const sorted = [...sizesHa].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
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
      degenerate: sorted[0] === sorted[n - 1],
      // Applies the REAL rule rather than hardcoding a shape, so the fixture
      // cannot drift from production: nearest-rank per FireSTARR's
      // Statistics.h, withheld below N=11.
      percentileStats:
        n < 11
          ? {
              kind: 'withheld' as const,
              n,
              reason: `ensemble of ${n} is too small for a median or percentile`,
            }
          : {
              kind: 'available' as const,
              medianHa: sorted[Math.trunc(n / 2)],
              percentilesHa: {
                50: sorted[Math.min(n - 1, Math.trunc(0.5 * n))],
                90: sorted[Math.min(n - 1, Math.trunc(0.9 * n))],
                95: sorted[Math.min(n - 1, Math.trunc(0.95 * n))],
              },
            },
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
    // Queried by test id, not by text, which also matches the heading.
    expect(screen.getByTestId('stat-n').textContent).toBe('2');
    expect(screen.getByTestId('fire-size-n').textContent).toMatch(/2 scenarios/);
    expect(screen.getByTestId('fire-size-n').textContent).toMatch(/2023-06-25/);
  });

  it('WITHHOLDS the median and percentiles below N=11, and SHOWS them above it', () => {
    // RE-AIMED 2026-10-28. #429 is answered: a row is one scenario's size at
    // that save time. So the rule is no longer "never a median" but "not below
    // N=11", where FireSTARR's own formulas put p90 and p95 on one index.
    //
    // The ids here were ALSO wrong before — it queried `stat-p90`/`stat-p95`
    // where the component renders `stat-p90Ha`/`stat-p95Ha`, so those two
    // assertions were null-vs-null and could never have failed.
    const { unmount } = render(
      <FireSizeDistribution resolution={{ hasEnsemble: true, series: series([day([100, 200, 300])]), reason: null }} />,
    );
    expect(screen.queryByTestId('stat-medianHa')).toBeNull();
    expect(screen.queryByTestId('stat-p90Ha')).toBeNull();
    expect(screen.queryByTestId('stat-p95Ha')).toBeNull();

    // Stated, not silent: #419 requires a small ensemble to SAY so.
    expect(screen.getByTestId('fire-size-withheld').textContent).toMatch(/3 scenarios/);

    // The control: the table must still render what it does keep, or an empty
    // table would satisfy the assertions above.
    expect(screen.getByTestId('stat-minHa').textContent).toMatch(/100/);
    expect(screen.getByTestId('stat-meanHa').textContent).toMatch(/200/);
    expect(screen.getByTestId('stat-maxHa').textContent).toMatch(/300/);
    unmount();

    // THE DISCRIMINATING HALF. Without it every assertion above is satisfied by
    // a component that never shows a median at all — which is precisely the
    // vacuity this test was re-aimed to escape.
    const eleven = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    render(<FireSizeDistribution resolution={{ hasEnsemble: true, series: series([day(eleven)]), reason: null }} />);
    expect(screen.getByTestId('stat-medianHa').textContent).toMatch(/6/);
    expect(screen.getByTestId('stat-p90Ha').textContent).toMatch(/10/);
    expect(screen.getByTestId('stat-p95Ha').textContent).toMatch(/11/);
    expect(screen.queryByTestId('fire-size-withheld')).toBeNull();
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
    expect(screen.getByText(/every scenario/i)).toBeTruthy();
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

describe('FireSizeDistribution painting', () => {
  // Regression: the first build set strokeWidth but never stroke, which
  // defaults to none — the CDF rendered as an empty box. Every test was green
  // because the element existed; only opening it in a browser showed it.
  it('draws the CDF line with an actual stroke, not just a width', () => {
    const { container } = render(
      <FireSizeDistribution resolution={{ hasEnsemble: true, series: series([day([1, 50, 120, 400, 900])]), reason: null }} />,
    );
    const path = container.querySelector('[data-testid="ecdf"] path');
    expect(path).toBeTruthy();
    const stroke = path!.getAttribute('stroke');
    expect(stroke).toBeTruthy();
    expect(stroke).not.toBe('none');
  });

  it('fills the histogram bars rather than leaving them the browser default', () => {
    const { container } = render(
      <FireSizeDistribution resolution={{ hasEnsemble: true, series: series([day([1, 50, 120, 400, 900])]), reason: null }} />,
    );
    const rects = container.querySelectorAll('[data-testid="histogram"] rect');
    expect(rects.length).toBeGreaterThan(0);
    rects.forEach(r => expect(r.getAttribute('fill')).toBeTruthy());
  });
});
