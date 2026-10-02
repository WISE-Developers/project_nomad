/**
 * Wizard Context — the context object.
 *
 * Separate from WizardProvider.tsx so that the provider file exports
 * nothing but a component. Vite's fast refresh can only hot-swap a module
 * whose exports are all components; a context object alongside them forces a
 * full reload and tears down state on every edit.
 */

import { createContext } from 'react';
import type { WizardContextValue } from '../types';

// Create context with generic type
export const WizardContext = createContext<WizardContextValue | null>(null);
