/**
 * A render harness for wizard step components. Issue #395.
 *
 * Wizard steps consume up to four contexts — Wizard, openNomad, Draw and Map —
 * and standing them up was the whole cost of writing a test for one. So none
 * got written: `SpatialInputStep` had no tests at all, and #393's fix to it
 * landed on inspection.
 *
 * ## Why this does not provide all four
 *
 * Two of the four contexts are private. `MapContext.tsx:5` and
 * `DrawContext.tsx:47` both do `const XContext = createContext(...)` with no
 * export, so nothing outside those modules can render their Provider with a
 * chosen value. They can only be supplied by mocking the module, and `vi.mock`
 * is hoisted per test file — a helper cannot do it on a caller's behalf.
 *
 * So the split is:
 *
 * - **Wizard and openNomad** — real providers, supplied here.
 * - **Draw and Map** — the test file writes a two-line `vi.mock`, using the
 *   factories below so the context shapes live in one place rather than being
 *   re-invented in each file.
 *
 * **Embedded mode needs no mocking at all.** `useDrawOptional` and
 * `useMapOptional` return null when no provider is present, and that IS
 * embedded mode — the branch where the host owns the map.
 *
 * If those two contexts are ever exported, this harness can provide all four
 * and the `vi.mock` block in callers goes away.
 *
 * ## Usage
 *
 *     // embedded mode — nothing else needed
 *     renderWizardStep(<SpatialInputStep />);
 *
 *     // SAN mode
 *     const drawCtx = createMockDrawContext();
 *     vi.mock('../../../Map/context/DrawContext', async (importOriginal) => ({
 *       ...(await importOriginal<object>()),
 *       useDrawOptional: () => drawCtx,
 *     }));
 */

import React from 'react';
import { render, type RenderResult } from '@testing-library/react';

import { OpenNomadProvider } from '../../openNomad/context/OpenNomadContext.js';
import { createMockOpenNomadAPI } from '../mocks/openNomad.js';
import { WizardProvider } from '../../features/Wizard/context/WizardContext.js';

import type { IOpenNomadAPI } from '../../openNomad/api.js';
import type { WizardConfig, WizardStep } from '../../features/Wizard/types/index.js';
import type { DrawnFeature, DrawingMode } from '../../features/Map/types/geometry.js';

/**
 * Steps used when a caller does not supply its own. Mirrors the real
 * ModelSetup order closely enough that index-sensitive logic behaves, without
 * importing it — a test should not break because a product step was renamed.
 */
const DEFAULT_STEPS: WizardStep[] = [
  { id: 'spatial', name: 'Spatial Input' },
  { id: 'temporal', name: 'Temporal' },
  { id: 'weather', name: 'Weather' },
  { id: 'model', name: 'Model' },
  { id: 'review', name: 'Review' },
];

export interface RenderWizardStepOptions {
  /** Seed wizard data. Steps read this through useWizardData. */
  initialData?: Record<string, unknown>;
  /** Override the step list when a test depends on step order or count. */
  steps?: WizardStep[];
  /** Supply a specific openNomad adapter; defaults to the shared mock. */
  adapter?: IOpenNomadAPI;
  /** Extra wizard config — onStepChange, validators, and so on. */
  config?: Partial<WizardConfig<Record<string, unknown>>>;
}

/**
 * Render a wizard step inside the providers it needs.
 *
 * Returns Testing Library's RenderResult unchanged, so `rerender`, `unmount`
 * and the queries all behave as callers expect. `rerender` re-renders the step
 * inside the SAME providers, which is what makes re-render identity and
 * mutation tests possible.
 */
export function renderWizardStep(
  ui: React.ReactElement,
  options: RenderWizardStepOptions = {}
): RenderResult {
  const {
    initialData = {},
    steps = DEFAULT_STEPS,
    adapter = createMockOpenNomadAPI(),
    config = {},
  } = options;

  const wizardConfig: WizardConfig<Record<string, unknown>> = {
    steps,
    initialData,
    // Unique per render so one test's draft cannot leak into the next through
    // localStorage. Wizard state autosaves under this key.
    storageKey: `test-wizard-${Math.random().toString(36).slice(2)}`,
    ...config,
  };

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <OpenNomadProvider adapter={adapter}>
        <WizardProvider config={wizardConfig}>{children}</WizardProvider>
      </OpenNomadProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}

/**
 * A DrawContext value for SAN-mode tests.
 *
 * Every function is a no-op rather than a vi.fn, so the harness carries no
 * assertion state between tests. A caller that needs to assert a call passes
 * its own spy through `overrides`.
 */
export function createMockDrawContext(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      mode: 'static' as DrawingMode,
      selectedIds: [] as string[],
      features: [] as DrawnFeature[],
    },
    setMode: () => {},
    getFeatures: () => [] as DrawnFeature[],
    deleteSelected: () => {},
    deleteAll: () => {},
    addFeatures: () => {},
    isReady: true,
    ...overrides,
  };
}

/**
 * A MapContext value for SAN-mode tests.
 *
 * `map` is null by default: a real MapLibre instance cannot be created in
 * jsdom, and steps guard on it. A test that needs map interactions passes a
 * stub through `overrides`.
 */
export function createMockMapContext(overrides: Record<string, unknown> = {}) {
  return {
    map: null,
    isLoaded: true,
    isLoading: false,
    error: null,
    ...overrides,
  };
}
