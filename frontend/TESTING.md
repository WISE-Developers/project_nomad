# Testing Guide for Project Nomad Frontend

This document describes the testing infrastructure and how to run tests for the Project Nomad frontend.

## Unit Tests (Vitest)

Unit tests use Vitest with React Testing Library.

### Running Unit Tests

```bash
# Run tests once
npm run test --workspace=@nomad/frontend

# Run tests in watch mode
npm run test:watch --workspace=@nomad/frontend
```

## End-to-End Tests (Playwright)

E2E tests use Playwright to test the application through a real browser.

### Prerequisites

1. **Install Playwright browsers** (first time only):
   ```bash
   npx playwright install chromium
   ```

2. **Configure environment** (for full functionality):
   Copy `.env.example` to `.env` and configure:
   - `VITE_API_BASE_URL` - Backend API URL
   - `VITE_MAPBOX_TOKEN` - MapBox access token

   > Note: Smoke tests will pass even without configuration, but map-related tests will skip with a note.

### Running E2E Tests

```bash
# Run all E2E tests (headless)
npm run test:e2e --workspace=@nomad/frontend

# Run E2E tests with browser UI visible
npm run test:e2e:headed --workspace=@nomad/frontend

# Run E2E tests with Playwright UI for debugging
npm run test:e2e:ui --workspace=@nomad/frontend
```

### Test Structure

E2E tests are located in `frontend/e2e/`:

```
e2e/
  smoke.spec.ts     # Basic smoke tests for app loading and responsiveness
```

### Test Categories

#### Smoke Tests
- Application loads without critical errors
- Page title is correct
- No viewport overflow issues

#### Map Rendering Tests
- Map container renders when properly configured
- Tests gracefully handle missing configuration

#### Responsive Design Tests
- Mobile viewport (375x812 - iPhone 11 Pro)
- Tablet viewport (768x1024)
- Desktop viewport (1920x1080)

### Writing New E2E Tests

Create new test files in `frontend/e2e/` with the `.spec.ts` extension:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('should do something', async ({ page }) => {
    await page.goto('/');
    // ... test assertions
  });
});
```

### Configuration

Playwright configuration is in `frontend/playwright.config.ts`:

- **Test directory**: `./e2e`
- **Base URL**: `http://localhost:5173`
- **Browser**: Chromium (add more in projects array)
- **Dev server**: Automatically starts via `npm run dev`

### CI/CD Integration

For CI environments:

```bash
# Install browsers in CI
npx playwright install --with-deps chromium

# Run tests
npm run test:e2e --workspace=@nomad/frontend
```

Set `CI=true` environment variable for:
- Retries on failure
- Single worker execution
- No dev server reuse

### Debugging Failed Tests

1. **View HTML report**:
   ```bash
   npx playwright show-report
   ```

2. **Run specific test**:
   ```bash
   npm run test:e2e --workspace=@nomad/frontend -- --grep "test name"
   ```

3. **Debug mode**:
   ```bash
   npm run test:e2e --workspace=@nomad/frontend -- --debug
   ```

4. **Screenshots**: Failed tests automatically capture screenshots in `test-results/`

### Test Artifacts

- **Screenshots**: Captured on failure in `test-results/`
- **HTML Report**: Generated in `playwright-report/`
- **Traces**: Captured on first retry for debugging

## Test Commands Summary

| Command | Description |
|---------|-------------|
| `npm test` | Run unit tests |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run test:e2e` | Run E2E tests (headless) |
| `npm run test:e2e:headed` | Run E2E tests with visible browser |
| `npm run test:e2e:ui` | Run E2E tests with Playwright UI |
