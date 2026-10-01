/**
 * OpenNomad Context — the context object holding the openNomad API adapter.
 *
 * Separate from OpenNomadProvider.tsx so that the provider file exports
 * nothing but a component. Vite's fast refresh can only hot-swap a module
 * whose exports are all components; a context object alongside them forces a
 * full reload and tears down state on every edit.
 *
 * Null when no provider is present - useOpenNomad() will throw in this case.
 */

import { createContext } from 'react';
import type { IOpenNomadAPI } from '../api.js';

export const OpenNomadContext = createContext<IOpenNomadAPI | null>(null);
