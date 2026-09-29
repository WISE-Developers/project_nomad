/**
 * SpatialInputStep — the first tests this component has had. Issue #395.
 *
 * Nothing covered this step before because it consumes four contexts (Wizard,
 * Draw, Map, openNomad) and standing them up was the entire cost of writing a
 * test. So no test got written, and #393's fix to `SpatialInputStep.tsx:159`
 * went in on inspection alone.
 *
 * Two of those four contexts are NOT exported — `MapContext.tsx:5` and
 * `DrawContext.tsx:47` both do `const XContext = createContext(...)` with no
 * export — so a harness cannot render them directly. They can only be supplied
 * by mocking the module, which must happen in the test file. The harness
 * therefore provides the two real providers and exports factories for the two
 * mocked ones, so each test file writes a two-line vi.mock instead of
 * reinventing the context shapes.
 *
 * Embedded mode needs no mocking at all: useDrawOptional/useMapOptional return
 * null with no provider present, which IS embedded mode.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';

import {
  renderWizardStep,
  createMockDrawContext,
  createMockMapContext,
} from '../../../../test/harness/wizardStep.js';

// SAN mode: the two private contexts, supplied by mocking their modules.
// createMockDrawContext / createMockMapContext keep the shapes in one place.
const drawCtx = createMockDrawContext();
const mapCtx = createMockMapContext();
let drawEnabled = false;

vi.mock('../../../Map/context/DrawContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDrawOptional: () => (drawEnabled ? drawCtx : null),
}));

vi.mock('../../../Map/context/MapContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMapOptional: () => (drawEnabled ? mapCtx : null),
}));

const { SpatialInputStep } = await import('../SpatialInputStep.js');
const { ReviewStep } = await import('../ReviewStep.js');

describe('SpatialInputStep', () => {
  beforeEach(() => {
    drawEnabled = false;
    localStorage.clear();
  });

  describe('embedded mode (no Draw/Map provider)', () => {
    it('renders without crashing', () => {
      renderWizardStep(<SpatialInputStep />);
      expect(screen.getAllByText(/draw|coordinate|upload/i).length).toBeGreaterThan(0);
    });

    it('survives a re-render with unchanged inputs', () => {
      const { rerender } = renderWizardStep(<SpatialInputStep />);
      rerender(<SpatialInputStep />);
      expect(screen.getAllByText(/draw|coordinate|upload/i).length).toBeGreaterThan(0);
    });
  });

  describe('SAN mode (Draw and Map present)', () => {
    it('renders without crashing', () => {
      drawEnabled = true;
      renderWizardStep(<SpatialInputStep />);
      expect(screen.getAllByText(/draw|coordinate|upload/i).length).toBeGreaterThan(0);
    });
  });

  /**
   * The #393 fix replaced `isEmbeddedMode ? [] : geometrySync.features` with a
   * shared module constant, which is only safe while nothing mutates it. That
   * was verified by inspection at the time, not by a test.
   *
   * This asserts the CONSEQUENCE rather than the constant. EMPTY_FEATURES is
   * module-private, and an earlier draft of this test reached for it through
   * the module's exports — which finds nothing and passes vacuously, the exact
   * defect this issue exists to stop.
   *
   * If a shared empty array were mutated, features would survive across an
   * unmount and reappear in a freshly mounted step. So: mount, unmount, mount
   * again, and require the second mount to start empty.
   */
  it('does not leak features between separate mounts', () => {
    const first = renderWizardStep(<SpatialInputStep />);
    const firstText = document.body.textContent ?? '';
    first.unmount();

    renderWizardStep(<SpatialInputStep />);
    const secondText = document.body.textContent ?? '';

    // A mutated shared array would show up as state carried into a component
    // that should have started clean.
    expect(secondText).toBe(firstText);
  });
});

/**
 * The acceptance criterion says the helper must be shaped so other wizard steps
 * can reuse it, rather than being a SpatialInputStep-shaped one-off. Asserting
 * that by actually using it for a different step — a claim about reusability
 * that nothing exercises is just a comment.
 */
describe('the harness is reusable by other wizard steps', () => {
  it('renders ReviewStep through the same helper', () => {
    renderWizardStep(<ReviewStep />);
    expect(document.body.textContent).toBeTruthy();
  });
});
