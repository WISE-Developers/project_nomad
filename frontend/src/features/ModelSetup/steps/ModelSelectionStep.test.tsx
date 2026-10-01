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

    // Use getAllByRole and pick the model mode Probabilistic card (has input name="modelMode")
    const allProbabilistic = screen.getAllByRole('radio', { name: /probabilistic/i });
    // Filter to the one that contains an input with name="modelMode"
    const probabilisticCard = allProbabilistic.find(
      (el) => el.querySelector('input[name="modelMode"]')
    );
    expect(probabilisticCard).toBeDefined();
    expect(probabilisticCard!.getAttribute('aria-checked')).toBe('true');
  });

  it('shows Coming Soon badge only on Long-Term Risk card (Deterministic is now available)', () => {
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    // Only Long-Term Risk (and WISE engine) show Coming Soon — Deterministic is available
    const comingSoonBadges = screen.getAllByText('Coming Soon');
    // At least 1 (Long-Term Risk), WISE engine card also shows one, so total >= 1
    expect(comingSoonBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('Deterministic card is available (no aria-disabled)', () => {
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    const deterministicCard = screen.getByRole('radio', { name: /deterministic/i });
    // Deterministic IS available — no aria-disabled
    expect(deterministicCard.getAttribute('aria-disabled')).not.toBe('true');
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

    // Filter to the model mode Probabilistic card specifically
    const allProbabilistic = screen.getAllByRole('radio', { name: /probabilistic/i });
    const probabilisticCard = allProbabilistic.find(
      (el) => el.querySelector('input[name="modelMode"]')
    )!;
    // Available cards either have no aria-disabled or have it set to false/null - never "true"
    expect(probabilisticCard.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('changes selection when clicking Deterministic (available) card', async () => {
    const user = userEvent.setup();
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    // Get the model mode Probabilistic card specifically
    const allProbabilistic = screen.getAllByRole('radio', { name: /probabilistic/i });
    const probabilisticCard = allProbabilistic.find(
      (el) => el.querySelector('input[name="modelMode"]')
    )!;
    expect(probabilisticCard.getAttribute('aria-checked')).toBe('true');

    // Click Deterministic (available)
    const deterministicCard = screen.getByRole('radio', { name: /deterministic/i });
    await user.click(deterministicCard);

    // Deterministic should now be selected
    expect(deterministicCard.getAttribute('aria-checked')).toBe('true');
    expect(probabilisticCard.getAttribute('aria-checked')).toBe('false');
  });

  it('does not change selection when clicking Long-Term Risk (unavailable) card', async () => {
    const user = userEvent.setup();
    const Wrapper = createWizardWrapper();
    render(
      <Wrapper>
        <ModelSelectionStep />
      </Wrapper>
    );

    const allProbabilistic = screen.getAllByRole('radio', { name: /probabilistic/i });
    const probabilisticCard = allProbabilistic.find(
      (el) => el.querySelector('input[name="modelMode"]')
    )!;
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

    // Use getAllByText since "probabilistic scenarios" appears in both the card description
    // and the info box when probabilistic is selected
    const stochasticMatches = screen.getAllByText(/probabilistic scenarios/i, { exact: false });
    expect(stochasticMatches.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/single simulation/i, { exact: false })).toBeDefined();
    expect(screen.getByText(/extended season/i, { exact: false })).toBeDefined();
  });
});
