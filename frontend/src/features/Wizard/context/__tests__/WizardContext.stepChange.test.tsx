/**
 * The onStepChange contract — issue #393 group C.
 *
 * `WizardConfig.onStepChange` is a documented public callback
 * (features/Wizard/types/index.ts:155): "Callback on step change", called with
 * (fromIndex, toIndex, data).
 *
 * WizardProvider.tsx declares its previous-index tracker as a PLAIN OBJECT
 * LITERAL, not a ref:
 *
 *     const prevStepIndexRef = { current: currentStepIndex };
 *
 * That is rebuilt on every render with `current` set to the CURRENT index, so
 * the guard on line 79 (`prevStepIndexRef.current !== currentStepIndex`) can
 * never be true and onStepChange is never called. The write on line 82 stores
 * into an object that is discarded at the end of the render.
 *
 * These tests assert the published contract rather than the mechanism, so they
 * stay valid whichever way the tracker is fixed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { WizardProvider } from '../WizardProvider.js';
import { useWizardNavigation } from '../useWizard.js';
import type { WizardConfig, WizardStep } from '../../types/index.js';

const STEPS: WizardStep[] = [
  { id: 'first', name: 'First' },
  { id: 'second', name: 'Second' },
  { id: 'third', name: 'Third' },
];

type Data = Record<string, unknown>;

describe('WizardConfig.onStepChange', () => {
  let onStepChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    onStepChange = vi.fn();
  });

  function setup() {
    const config: WizardConfig<Data> = {
      steps: STEPS,
      initialData: {},
      storageKey: `test-wizard-${Math.random()}`,
      onStepChange,
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <WizardProvider config={config}>{children}</WizardProvider>
    );

    return renderHook(() => useWizardNavigation(), { wrapper });
  }

  it('fires when the wizard advances a step', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.goNext();
    });

    await waitFor(() => {
      expect(onStepChange).toHaveBeenCalled();
    });
  });

  it('reports the indexes it moved between', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.goNext();
    });

    await waitFor(() => {
      expect(onStepChange).toHaveBeenCalledWith(0, 1, expect.anything());
    });
  });

  it('does not fire on the initial render, when no step has changed', async () => {
    setup();

    // Nothing moved, so nothing should have been reported.
    expect(onStepChange).not.toHaveBeenCalled();
  });
});
