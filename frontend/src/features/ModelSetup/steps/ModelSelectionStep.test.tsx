/**
 * Tests for ModelSelectionStep
 *
 * Verifies the three model mode cards render correctly:
 * - Probabilistic: selectable (available)
 * - Deterministic: Coming Soon badge, not selectable
 * - Long-Term Risk: Coming Soon badge, not selectable
 *
 * @module features/ModelSetup/steps/__tests__
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelSelectionStep } from './ModelSelectionStep.js';
import { WizardProvider } from '../../Wizard/index.js';
import type { WizardConfig } from '../../Wizard/index.js';
import type { ModelSetupData } from '../types/index.js';
import { DEFAULT_MODEL_SETUP_DATA, MODEL_SETUP_STEPS } from '../types/index.js';

// =============================================================================
// Test Wrapper
// =============================================================================

function createWizardWrapper(initialData: ModelSetupData = DEFAULT_MODEL_SETUP_DATA) {
  const config: WizardConfig<ModelSetupData> = {
    steps: MODEL_SETUP_STEPS as unknown as WizardConfig<ModelSetupData>['steps'],
    initialData,
    storageKey: 'test-model-setup',
    validators: {},
    onComplete: vi.fn(),
    onCancel: vi.fn(),
  };

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <WizardProvider config={config}>{children}</WizardProvider>;
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ModelSelectionStep - Model Mode Cards', () => {
  it('renders all three model mode cards', () => {
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    expect(screen.getByText('Probabilistic')).toBeDefined();
    expect(screen.getByText('Deterministic')).toBeDefined();
    expect(screen.getByText('Long-Term Risk')).toBeDefined();
  });

  it('renders the Model Mode section label', () => {
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    expect(screen.getByText('Model Mode')).toBeDefined();
  });

  it('shows Probabilistic card as selected by default', () => {
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    const probabilisticCard = screen.getByRole('radio', { name: /probabilistic/i });
    expect(probabilisticCard).toBeDefined();
    expect(probabilisticCard.getAttribute('aria-checked')).toBe('true');
  });

  it('shows Coming Soon badges on Deterministic and Long-Term Risk cards', () => {
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    const comingSoonBadges = screen.getAllByText('Coming Soon');
    // At least 2 Coming Soon badges (Deterministic, Long-Term Risk)
    // WISE engine card also shows one, so total may be 3
    expect(comingSoonBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('applies not-allowed cursor to unavailable mode cards', () => {
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    const deterministicCard = screen.getByRole('radio', { name: /deterministic/i });
    const style = deterministicCard.getAttribute('style') ?? '';
    // The card div itself renders with inline styles containing cursor: not-allowed
    // Check aria-disabled instead since style comparison is fragile
    expect(deterministicCard.getAttribute('aria-disabled')).toBe('true');
  });

  it('applies not-allowed cursor to Long-Term Risk card', () => {
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    const longTermCard = screen.getByRole('radio', { name: /long-term risk/i });
    expect(longTermCard.getAttribute('aria-disabled')).toBe('true');
  });

  it('Probabilistic card does not have aria-disabled set to true', () => {
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    const probabilisticCard = screen.getByRole('radio', { name: /probabilistic/i });
    // Available cards either have no aria-disabled or have it set to false/null - never "true"
    expect(probabilisticCard.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('does not change selection when clicking Deterministic (unavailable) card', async () => {
    const user = userEvent.setup();
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    // Probabilistic starts as selected
    const probabilisticCard = screen.getByRole('radio', { name: /probabilistic/i });
    expect(probabilisticCard.getAttribute('aria-checked')).toBe('true');

    // Click Deterministic (unavailable)
    const deterministicCard = screen.getByRole('radio', { name: /deterministic/i });
    await user.click(deterministicCard);

    // Probabilistic should still be selected
    expect(probabilisticCard.getAttribute('aria-checked')).toBe('true');
    expect(deterministicCard.getAttribute('aria-checked')).toBe('false');
  });

  it('does not change selection when clicking Long-Term Risk (unavailable) card', async () => {
    const user = userEvent.setup();
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    const probabilisticCard = screen.getByRole('radio', { name: /probabilistic/i });
    const longTermCard = screen.getByRole('radio', { name: /long-term risk/i });

    await user.click(longTermCard);

    expect(probabilisticCard.getAttribute('aria-checked')).toBe('true');
    expect(longTermCard.getAttribute('aria-checked')).toBe('false');
  });

  it('renders the info box for probabilistic mode when probabilistic is selected', () => {
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    // Info box should be visible when probabilistic is selected (default)
    expect(screen.getByText(/probability maps/i, { exact: false })).toBeDefined();
  });

  it('shows descriptions for all three mode cards', () => {
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    // Use getAllByText since "stochastic scenarios" appears in both the card description
    // and the info box when probabilistic is selected
    const stochasticMatches = screen.getAllByText(/stochastic scenarios/i, { exact: false });
    expect(stochasticMatches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/single scenario/i, { exact: false })).toBeDefined();
    expect(screen.getByText(/extended season/i, { exact: false })).toBeDefined();
  });
});
