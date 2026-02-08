# Testing Patterns

**Analysis Date:** 2026-02-06

## Test Framework

**Runner:**
- **Vitest** v2.1.4
- Both frontend and backend use Vitest
- Frontend config: `frontend/vitest.config.ts`
- Backend: Uses vitest directly via npm script

**Environment:**
- Frontend: `jsdom` (DOM-like environment for React component testing)
- Backend: Node.js default environment

**Assertion Library:**
- **Vitest built-in** (expect API compatible with Jest)
- Additional: `@testing-library/jest-dom` for DOM assertions (frontend)

**Run Commands:**
```bash
npm test                # Run all tests across workspaces
npm run test:watch     # Watch mode (available in both packages)
npm run test:coverage  # Coverage report (frontend: v8 provider)
npx jest src/path      # Run single test file (not vitest syntax)
```

## Test File Organization

**Location:**
- **Frontend**: Colocated with source files (adjacent to implementation)
  - Examples: `src/openNomad/context/OpenNomadContext.test.tsx`, `src/features/Dashboard/components/DashboardContainer.test.tsx`
  - Alternative: `src/openNomad/__tests__/` subdirectory (for unit test files)

- **Backend**: Colocated with source files in `__tests__` subdirectories
  - Example: `src/core/deployment/__tests__/ServiceFactory.test.ts`

**Naming:**
- `.test.ts` suffix for TypeScript unit tests
- `.test.tsx` suffix for React component tests
- Pattern: `ComponentName.test.tsx` or `serviceName.test.ts`

**Structure:**
```
frontend/
├── src/
│   ├── openNomad/
│   │   ├── context/
│   │   │   ├── OpenNomadContext.tsx
│   │   │   └── OpenNomadContext.test.tsx
│   │   └── __tests__/
│   │       └── DefaultOpenNomadAPI.test.ts
│   └── test/
│       ├── setup.ts          # Test environment setup
│       └── mocks/
│           └── openNomad.ts  # Mock implementations

backend/
├── src/
│   └── core/deployment/
│       ├── ServiceFactory.ts
│       └── __tests__/
│           ├── ServiceFactory.test.ts
│           └── DeploymentMode.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
// From OpenNomadContext.test.tsx
describe('OpenNomadContext', () => {
  let mockApi: IOpenNomadAPI;

  beforeEach(() => {
    mockApi = createMockOpenNomadAPI();
  });

  describe('OpenNomadProvider', () => {
    it('provides the API to child components', async () => {
      render(...);
      await waitFor(() => {
        expect(...).toHaveTextContent(...);
      });
    });
  });
});
```

**Patterns:**
- **Setup**: `beforeEach()` to initialize mocks and state
- **Cleanup**: `afterEach()` to clear mocks via `vi.clearAllMocks()` and `localStorage.clear()`
- **Teardown**: `afterEach()` with explicit resource cleanup
- **Assertion**: `expect()` with Vitest matchers

**Frontend Test Pattern:**
```typescript
describe('Component', () => {
  beforeEach(() => {
    mockApi = createMockOpenNomadAPI();
  });

  it('should render correctly', async () => {
    render(
      <OpenNomadProvider adapter={mockApi}>
        <TestComponent />
      </OpenNomadProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('element')).toHaveTextContent('text');
    });
  });
});
```

**Backend Test Pattern:**
```typescript
describe('ServiceFactory', () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry();
    ServiceFactory.resetInstance();
  });

  afterEach(() => {
    ServiceFactory.resetInstance();
  });

  it('reports SAN mode correctly', () => {
    const factory = new ServiceFactory(envService, registry);
    expect(factory.getDeploymentMode()).toBe('SAN');
  });
});
```

## Mocking

**Framework:** Vitest `vi` module

**Mock Location:**
- Centralized mock implementations in `src/test/mocks/`
- Example: `frontend/src/test/mocks/openNomad.ts` exports mock API factories

**Patterns:**

**1. Module Mocking:**
```typescript
// From DefaultOpenNomadAPI.test.ts
vi.mock('../../services/api', () => ({
  getModels: vi.fn(),
  getModel: vi.fn(),
  deleteModel: vi.fn(),
  getJob: vi.fn(),
  getConfig: vi.fn(),
}));

import { getModels, getModel, deleteModel } from '../../services/api';
```

**2. Function Mocking with Return Values:**
```typescript
vi.mocked(getModels).mockResolvedValue({
  models: mockModels,
  total: 2,
});

const result = await api.models.list();
expect(getModels).toHaveBeenCalledTimes(1);
```

**3. Browser API Mocking:**
```typescript
// From test/setup.ts
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
```

**What to Mock:**
- External API calls (services)
- Browser APIs (matchMedia, ResizeObserver, IntersectionObserver)
- Date/time functions when time-dependent
- File I/O and network operations

**What NOT to Mock:**
- Core React components and hooks
- Custom business logic (test actual behavior)
- Type utilities and helpers
- Internal state management (Context, useState)

## Fixtures and Factories

**Test Data:**
Factory functions that create mock data:

```typescript
// From test/mocks/openNomad.ts
export const mockUser: User = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  role: 'fban',
  agencyId: 'test-agency',
};

export const mockModels: Model[] = [
  {
    id: 'model-1',
    name: 'Test Fire Model 1',
    engine: 'firestarr',
    status: 'completed',
    ...
  },
  // ... more test data
];

export function createMockOpenNomadAPI(): IOpenNomadAPI {
  return {
    auth: {
      getCurrentUser: vi.fn().mockResolvedValue(mockUser),
      getAuthToken: vi.fn(),
      onAuthChange: vi.fn(),
    },
    models: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    // ... more API modules
  };
}
```

**Location:**
- `frontend/src/test/mocks/` - Centralized mock implementations
- Named exports for individual data objects
- Factory functions prefixed with `createMock`

## Setup Files

**Frontend Setup:**
- Location: `frontend/src/test/setup.ts`
- Runs before all tests (configured in `vitest.config.ts`)
- Imports: `@testing-library/jest-dom`
- Mocks browser APIs that components depend on

**Configuration Reference:**
```typescript
// From vitest.config.ts
test: {
  environment: 'jsdom',
  globals: true,
  setupFiles: ['./src/test/setup.ts'],
  include: ['src/**/*.{test,spec}.{ts,tsx}'],
}
```

## Coverage

**Requirements:** Not enforced (no coverage thresholds configured)

**Frontend Coverage Settings:**
```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'html'],
  include: ['src/**/*.{ts,tsx}'],
  exclude: ['src/test/**', 'src/**/*.d.ts'],
}
```

**View Coverage:**
```bash
npm run test:coverage
# Generates HTML report (location: frontend/coverage/)
```

## Test Types

**Unit Tests:**
- Scope: Individual functions, hooks, and utilities
- Approach: Mock dependencies, test inputs/outputs
- Examples: `DefaultOpenNomadAPI.test.ts`, `ServiceFactory.test.ts`
- Test file structure:
  - Each test suite covers one module/class
  - Setup with `beforeEach`, cleanup with `afterEach`
  - Group related tests with nested `describe` blocks

**Integration Tests:**
- Scope: React components with context/providers
- Approach: Render components, query DOM, simulate user interactions
- Examples: `OpenNomadContext.test.tsx`, `DashboardContainer.test.tsx`
- Pattern:
  ```typescript
  render(
    <OpenNomadProvider adapter={mockApi}>
      <Component />
    </OpenNomadProvider>
  );
  // Assert component behavior
  ```
- Use `@testing-library/react` for DOM queries and `userEvent` for interactions

**E2E Tests:**
- Not currently implemented in codebase
- Would test full workflows end-to-end

## Common Patterns

**Async Testing:**
```typescript
// From OpenNomadContext.test.tsx
it('provides the API to child components', async () => {
  render(
    <OpenNomadProvider adapter={mockApi}>
      <TestConsumer />
    </OpenNomadProvider>
  );

  await waitFor(() => {
    expect(screen.getByTestId('user-name')).toHaveTextContent(mockUser.name);
  });
});
```

**Error Testing:**
```typescript
// From OpenNomadContext.test.tsx
it('throws when useOpenNomad is used outside provider', () => {
  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  expect(() => {
    render(<TestConsumer />);
  }).toThrow('useOpenNomad must be used within an OpenNomadProvider');

  consoleSpy.mockRestore();
});
```

**Status/State Testing:**
```typescript
// From DefaultOpenNomadAPI.test.ts
it('should apply status filter', async () => {
  const mockModels = [
    { id: 'model-1', status: 'completed' },
    { id: 'model-2', status: 'running' },
  ];

  vi.mocked(getModels).mockResolvedValue({
    models: mockModels,
    total: 2,
  });

  const result = await api.models.list({ status: 'completed' });

  expect(result.data).toHaveLength(1);
  expect(result.data[0].status).toBe('completed');
});
```

**localStorage Testing:**
```typescript
// From DefaultOpenNomadAPI.test.ts
it('should return user when username is in localStorage', async () => {
  localStorage.setItem('nomad_username', 'testuser');
  const user = await api.auth.getCurrentUser();
  expect(user).not.toBeNull();
  expect(user?.id).toBe('testuser');
});
```

**Spy Pattern:**
```typescript
// Mock and assert on specific calls
const callback = vi.fn();
const unsubscribe = api.auth.onAuthChange(callback);

expect(typeof unsubscribe).toBe('function');
unsubscribe();
```

## Test Data Strategy

**Backend Models:**
Array builders for model fixtures:
```typescript
const mockModels = Array.from({ length: 25 }, (_, i) => ({
  id: `model-${i}`,
  name: `Model ${i}`,
  // ... properties
}));
```

**Pagination Testing:**
```typescript
const result = await api.models.list({}, { page: 2, limit: 10 });

expect(result.data).toHaveLength(10);
expect(result.page).toBe(2);
expect(result.totalPages).toBe(3);
```

---

*Testing analysis: 2026-02-06*
