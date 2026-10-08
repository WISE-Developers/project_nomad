/**
 * The fuel vintage notice must sit on the same surface as the card holding it (#431).
 *
 * ModelSummary's cards are '#f8f9fa' (ModelSummary.tsx cardStyle) while
 * FuelVintageNotice defaulted to '#ffffff', so the notice rendered as a white
 * rectangle inset ~17px inside a grey card — a seam that read as a rendering
 * artifact rather than a highlight. Seen on screen 2026-10-08; measured as
 * rgb(255,255,255) inside rgb(248,249,250).
 *
 * The component-level test (FuelVintageNotice.surface.test.tsx) proves the
 * `surface` prop is honoured. This one proves THIS CALL SITE passes it. Without
 * it the prop could be honoured by a component nobody hands the right value to,
 * and the seam returns silently.
 *
 * It deliberately compares the notice against its own container rather than
 * pinning '#f8f9fa'. A pinned hex goes stale the moment either side is
 * restyled, and would then assert the wrong thing while still passing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ModelSummary } from '../ModelSummary';
import { DEFAULT_MODEL_SETUP_DATA } from '../../types';
import type { ModelSetupData } from '../../types';

vi.mock('../../../../services/api', () => ({
  getFuelDatasets: vi.fn(),
}));

import { getFuelDatasets } from '../../../../services/api';

const data: ModelSetupData = {
  ...DEFAULT_MODEL_SETUP_DATA,
  temporal: { ...DEFAULT_MODEL_SETUP_DATA.temporal, startDate: '2023-06-19' },
};

beforeEach(() => {
  vi.mocked(getFuelDatasets).mockResolvedValue({
    datasets: [],
    resolved: {
      requestedYear: 2023,
      datasetYear: 2023,
      fuelVintage: 2022,
      matchedRequestedYear: true,
      usedFallback: false,
      dataset: { datasetYear: 2023, fuelVintage: 2022, producer: 'Jordan Evens' },
    },
  } as Awaited<ReturnType<typeof getFuelDatasets>>);
});

describe('ModelSummary fuel vintage surface (#431)', () => {
  it('renders the notice on the same background as the card containing it', async () => {
    render(<ModelSummary data={data} />);

    const notice = await screen.findByTestId('fuel-vintage-notice');
    const card = notice.parentElement;

    expect(card).not.toBeNull();
    expect(card!.style.backgroundColor).not.toBe('');
    expect(notice.style.backgroundColor).toBe(card!.style.backgroundColor);
  });

  it('shows both years once resolution arrives', async () => {
    // Guards the seam fix against being made by simply not rendering the notice.
    render(<ModelSummary data={data} />);

    await waitFor(() => {
      expect(screen.getByTestId('model-year-value')).toHaveTextContent('2023');
      expect(screen.getByTestId('fuel-vintage-value')).toHaveTextContent('2022');
    });
  });
});
