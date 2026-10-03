/**
 * A render harness for wizard step components. Issue #395.
 *
 * Wizard steps consume up to four contexts — Wizard, openNomad, Draw and Map —
 * and standing them up was the whole cost of writing a test for one. So none
 * got written: `SpatialInputStep` had no tests at all, and #393's fix to it
 * landed on inspection.
 *
 * ## Why this provides two and mocks two
 *
 * CORRECTED 2026-10-03. This note used to say that `MapContext` and
 * `DrawContext` were private — `const XContext = createContext(...)` with no
 * export — and that mocking the module was therefore the only way to supply
 * them. **That is no longer true**, and the files it cited no longer exist
 * under those names.
 *
 * Both contexts are exported today, and the providers live in their own
 * modules:
 *
 *     MapContext.ts:19    export const MapContext  = createContext(...)
 *     DrawContext.ts:45   export const DrawContext = createContext(...)
 *     MapProvider.tsx     export function MapProvider
 *     DrawProvider.tsx    export function DrawProvider
 *
 * The change came with #386, which moved `MapProvider` out of `MapContext`.
 * Note what is exported and what is not: these are internal to the app's own
 * module graph. The openNomad PUBLIC surface exports `DashboardContainer`, the
 * adapters and `OpenNomadProvider` — never the map contexts. A client embeds
 * the dashboard and supplies an adapter; it never constructs a `DrawContext`.
 * That boundary is deliberate and is not what this note is about.
 *
 * So the current split is a matter of this harness not yet having been
 * converted, NOT a constraint of the codebase:
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
 * The open follow-up is to render the real `MapProvider` and `DrawProvider`
 * here and delete the `vi.mock` block from callers. Left as-is for now rather
 * than changed without a test to prove the swap is faithful — a harness that
 * silently stands up a different context shape than production would make every
 * test built on it a lie.
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

import { OpenNomadProvider } from '../../openNomad/context/OpenNomadProvider.js';
import { createMockOpenNomadAPI } from '../mocks/openNomad.js';
import { WizardProvider } from '../../features/Wizard/context/WizardProvider.js';

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
