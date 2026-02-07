# Coding Conventions

**Analysis Date:** 2026-02-06

## Naming Patterns

**Files:**
- Components: PascalCase (e.g., `App.tsx`, `DeploymentModeContext.tsx`, `ModelSetupWizard.tsx`)
- Services/utilities: camelCase (e.g., `useDeploymentMode.ts`, `DefaultOpenNomadAPI.ts`)
- Test files: colocated with source, suffixed with `.test.ts` or `.test.tsx` (e.g., `OpenNomadContext.test.tsx`)
- Directories: kebab-case for features (e.g., `src/features/ModelSetup`, `src/core/deployment`)

**Functions:**
- camelCase for all functions, hooks, and methods
- React hooks prefixed with `use` (e.g., `useOpenNomad()`, `useMap()`, `useDraw()`)
- Private functions inside files use camelCase with optional underscore prefix convention

**Variables:**
- camelCase for all variables, constants, and parameters
- React state setters use `setState` convention (e.g., `setShowWizard`, `setSubmitError`)
- Event handlers prefixed with `handle` (e.g., `handleNewModel()`, `handleWizardComplete()`)

**Types:**
- PascalCase for types, interfaces, and enums (e.g., `DeploymentMode`, `ModelSetupData`, `OutputItem`)
- Type imports explicit: `import type { ... }`
- Props interfaces end with `Props` suffix (e.g., `DeploymentModeProviderProps`)

## Code Style

**Formatting:**
- TypeScript strict mode enabled in both frontend and backend
- Target: ES2022
- Module system: ESNext with bundler module resolution
- No explicit formatter config found; ESLint configured for linting only

**Linting:**
- **Tool**: ESLint v9.14.0 with `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`
- **Frontend**: Includes `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`
- **Backend**: TypeScript-focused linting
- **Run command**: `npm run lint` (workspace applies to both packages)
  - Frontend: `eslint src/**/*.{ts,tsx}`
  - Backend: `eslint src/**/*.ts`

**TypeScript Configuration:**
- `strict: true` - All strict checks enabled
- `noUnusedLocals: true` - Enforce no unused local variables
- `noUnusedParameters: true` - Enforce no unused parameters
- `noImplicitReturns: true` - Require explicit returns
- `noFallthroughCasesInSwitch: true` - No switch fall-through
- `noUncheckedSideEffectImports: true` (frontend only) - Warn about side-effect imports

## Import Organization

**Order:**
1. External libraries (react, express, etc.)
2. Internal type imports (`import type { ... }`)
3. Internal module imports (`import { ... } from '@/...'`)
4. Relative imports (when necessary)

**Path Aliases:**
- Frontend: `@/*` maps to `src/*` (e.g., `@/features/Map`, `@/test/mocks`)
- Backend: `@/*` maps to `src/*` (e.g., `@/api/index`, `@/infrastructure/logging`)

**Example from `App.tsx`:**
```typescript
import { useState, useCallback, useRef, useMemo } from 'react';
import { SplashScreen } from './components/SplashScreen';
import { DeploymentModeProvider } from './core/deployment';
import type { OutputItem } from './features/ModelReview/types';
import { ModelSetupWizard } from './features/ModelSetup';
import { runModel } from './services/api';
import { OpenNomadProvider, createDefaultAdapter, useOpenNomad } from './openNomad';
```

## Error Handling

**Patterns:**
- Backend: Custom error classes extend `DomainError` hierarchy
  - `ValidationError` → 400 status
  - `NotFoundError` → 404 status
  - `EngineError` → 500 or 503 with retryable flag
  - Custom `DomainError` with `httpStatus` property
- Frontend: Try-catch blocks with error logging to console
- Error responses standardized with correlation IDs and consistent format
- Example from `errorHandler.ts`:
```typescript
if (err instanceof ValidationError) {
  res.status(400).json(createErrorResponse(err.code, err.message, correlationId, ...));
}
if (err instanceof NotFoundError) {
  res.status(404).json(createErrorResponse(err.code, err.message, correlationId));
}
```

**Async/Await:** Preferred over callbacks
- `useCallback` for React event handlers to prevent unnecessary re-renders
- Async operations wrapped in try-catch blocks
- Example from `App.tsx`:
```typescript
const handleWizardComplete = useCallback(async (data: ModelSetupData) => {
  try {
    const result = await runModel({ ... });
  } catch (error) {
    setSubmitError(error instanceof Error ? error.message : 'Failed');
  }
}, [requestPermission, watchJob]);
```

## Logging

**Framework:** Winston for backend, console for frontend

**Backend Pattern:**
- Location: `src/infrastructure/logging/logger.ts`
- Format: `[timestamp] [LEVEL] [correlationId] [Category] message`
- Local timezone timestamps (not UTC)
- Daily file rotation with 14-day retention, 50MB per file
- Separate error log file
- Logger methods include: `startup()`, `info()`, `error()`, `warn()`
- Example usage:
```typescript
logger.startup('Initializing database...');
logger.error(`${err.name}: ${err.message}`, 'ErrorHandler', { correlationId, path: req.path });
```

**Frontend Pattern:**
- Use `console.log()`, `console.error()`, `console.warn()`
- Include context in messages: `console.log('[App] Ignition geometry type:', geomType)`
- Example from `App.tsx`:
```typescript
console.log('Model setup complete:', data);
console.error('Failed to submit model:', error);
```

## Comments

**When to Comment:**
- Complex business logic or algorithms
- Non-obvious parameter/return value meanings
- JSDoc for public APIs and exported functions
- Inline comments for "why" not "what"

**JSDoc/TSDoc:**
- Used on test setup files and public modules
- Format: `/** ... */` with module and parameter descriptions
- Example from `setup.ts`:
```typescript
/**
 * Vitest Test Setup
 *
 * This file runs before all tests to set up the testing environment.
 *
 * @module test/setup
 */
```

## Function Design

**Size:** Keep functions small and focused (single responsibility principle)

**Parameters:**
- Destructuring for object parameters (see `DeploymentModeProviderProps`)
- Type annotations required on all parameters (TypeScript strict mode)
- Callbacks use `useCallback` hook in React components

**Return Values:**
- Explicit return types on all functions
- Void for side-effect functions
- Promise types for async functions
- Example from backend:
```typescript
async function initializeDatabaseLayer(): Promise<void> { ... }
function getCorsOptions(): CorsOptions { ... }
export const errorHandler: ErrorRequestHandler = (...): void => { ... }
```

## Module Design

**Exports:**
- Named exports preferred over default exports for utilities
- Default exports for React components and context providers
- Barrel files (`index.ts`) re-export from subdirectories
- Example from `openNomad/api.ts`: Named exports for types and interfaces
- Example from `App.tsx`: Default export for main component

**Barrel Files:**
- Used extensively to organize exports
- Examples: `src/openNomad/index.ts`, `src/core/deployment/index.ts`
- Pattern: `export { ComponentName } from './ComponentName.js'`
- Re-exports are transitional; actual code in individual files

## State Management Patterns

**React Context:**
- Created with explicit type or null default
- Example from `DeploymentModeContext.tsx`:
```typescript
export const DeploymentModeContext = createContext<DeploymentModeState | null>(null);
```

**Local State:**
- `useState` for component-level state
- `useRef` for non-rendering values (e.g., `layerCounter` in App.tsx)
- `useMemo` for expensive computations (e.g., API adapter creation)

**Custom Hooks:**
- Extract stateful logic into custom hooks
- Hooks use context internally (e.g., `useOpenNomad()`, `useMap()`)
- Optional variant pattern with null return (e.g., `useOpenNomadOptional()`)

---

*Convention analysis: 2026-02-06*
