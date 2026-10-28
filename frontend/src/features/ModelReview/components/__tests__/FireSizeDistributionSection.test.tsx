import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { OpenNomadProvider } from '../../../../openNomad/context/OpenNomadProvider.js';
import { FireSizeDistributionSection } from '../FireSizeDistributionSection';

function wrap(fetchImpl: ReturnType<typeof vi.fn>, children: ReactNode) {
  const adapter = { fetch: fetchImpl } as never;
  return render(<OpenNomadProvider adapter={adapter}>{children}</OpenNomadProvider>);
}

describe('FireSizeDistributionSection', () => {
  it('renders the distribution once loaded', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hasEnsemble: true,
        series: {
          days: [
            {
              julianDay: 176,
              date: '2023-06-25',
              sizesHa: [209352, 227341],
              reducedPrecision: false,
              summary: {
                n: 2, minHa: 209352, maxHa: 227341, meanHa: 218346.5,
                degenerate: false,
                percentileStats: {
                  kind: 'withheld' as const, n: 2,
                  reason: 'ensemble of 2 is too small for a median or percentile',
                },
              },
            },
          ],
          n: 2, nConstantAcrossDays: true, reducedPrecision: false,
        },
        reason: null,
      }),
    });
    wrap(f, <FireSizeDistributionSection modelId="m1" />);
    await waitFor(() => expect(screen.getByTestId('stat-n').textContent).toBe('2'));
  });

  it('says the ensemble is UNKNOWN when the request fails, not that there is none', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    wrap(f, <FireSizeDistributionSection modelId="m1" />);
    await waitFor(() => expect(screen.getByTestId('fire-size-error')).toBeTruthy());
    expect(screen.getByTestId('fire-size-error').textContent).toMatch(/unknown/i);
    expect(screen.queryByTestId('histogram')).toBeNull();
  });

  it('reports a recorded absence as an answer, with its reason', async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hasEnsemble: false, series: null, reason: 'this run recorded no fire-size files' }),
    });
    wrap(f, <FireSizeDistributionSection modelId="m1" />);
    await waitFor(() => expect(screen.getByText(/recorded no fire-size files/i)).toBeTruthy());
    expect(screen.queryByTestId('fire-size-error')).toBeNull();
  });
});
