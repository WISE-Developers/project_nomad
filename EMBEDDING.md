# Embedding the Nomad Dashboard

This guide covers how to embed the Project Nomad fire modeling dashboard into your agency's application.

## Quick Start

### 1. Install

```bash
npm install @nomad/frontend
```

Or via tarball:
```bash
npm install path/to/nomad-frontend-0.2.7.tgz
```

### 2. Create an Adapter

The adapter connects the dashboard to your backend services:

```typescript
// adapters/myAgencyAdapter.ts
import type { IOpenNomadAPI } from '@nomad/frontend';

export function createAdapter(authToken: string): IOpenNomadAPI {
  return {
    auth: { /* ... */ },
    models: { /* ... */ },
    jobs: { /* ... */ },
    results: { /* ... */ },
    spatial: { /* ... */ },
    config: { /* ... */ },
  };
}
```

### 3. Embed the Dashboard

```tsx
import { OpenNomadProvider, DashboardContainer } from '@nomad/frontend';
import { createAdapter } from './adapters/myAgencyAdapter';

function App() {
  const adapter = useMemo(() => createAdapter(authToken), [authToken]);

  return (
    <OpenNomadProvider adapter={adapter}>
      <DashboardContainer mode="embedded" />
    </OpenNomadProvider>
  );
}
```

## Build Outputs

The package provides multiple build formats:

| Format | File | Use Case |
|--------|------|----------|
| ES Module | `dist/openNomad.js` | Modern bundlers (Vite, Webpack 5, Rollup) |
| UMD | `dist/openNomad.umd.cjs` | Legacy bundlers, script tags, CDN |
| TypeScript | `dist/index.d.ts` | Type definitions |

### ES Module Usage (Recommended)

```typescript
import { OpenNomadProvider, DashboardContainer } from '@nomad/frontend';
```

### UMD / Script Tag Usage

```html
<script src="path/to/nomad/dist/openNomad.umd.cjs"></script>
<script>
  const { OpenNomadProvider, DashboardContainer } = window.NomadFrontend;
</script>
```

## Integration Scenarios

| Scenario | Pattern | When to Use |
|----------|---------|-------------|
| React app | `OpenNomadProvider` + `DashboardContainer` | Standard React integration |
| Non-React app | UMD bundle + manual rendering | jQuery, Angular, vanilla JS |
| Sidebar panel | `mode="embedded"` | Dashboard as part of larger UI |
| Floating window | `mode="floating"` | Draggable overlay |
| Full white-label | `NomadProvider` + customization | Complete agency branding |

## Common Examples

### Minimal React Embedding

```tsx
import { useMemo } from 'react';
import { OpenNomadProvider, DashboardContainer } from '@nomad/frontend';
import { createAgencyAdapter } from '@nomad/frontend';

export function NomadPanel({ authToken }: { authToken: string }) {
  const adapter = useMemo(
    () => createAgencyAdapter({ authToken, apiBaseUrl: '/api/nomad' }),
    [authToken]
  );

  return (
    <OpenNomadProvider adapter={adapter}>
      <DashboardContainer
        mode="embedded"
        onLaunchWizard={(draftId) => console.log('Launch wizard:', draftId)}
        onViewResults={(modelId) => console.log('View results:', modelId)}
      />
    </OpenNomadProvider>
  );
}
```

### Vanilla JS (UMD)

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="path/to/nomad/dist/openNomad.umd.cjs"></script>
</head>
<body>
  <div id="nomad-root"></div>
  <script>
    const { OpenNomadProvider, DashboardContainer, createAgencyAdapter } = window.NomadFrontend;

    const adapter = createAgencyAdapter({
      authToken: 'your-auth-token',
      apiBaseUrl: '/api/nomad',
    });

    const root = ReactDOM.createRoot(document.getElementById('nomad-root'));
    root.render(
      React.createElement(OpenNomadProvider, { adapter },
        React.createElement(DashboardContainer, { mode: 'embedded' })
      )
    );
  </script>
</body>
</html>
```

### Custom Theming

```tsx
import { NomadProvider, DashboardContainer } from '@nomad/frontend';

const agencyTheme = {
  '--nomad-primary': '#003366',
  '--nomad-primary-light': '#1a5488',
  '--nomad-font-family': '"Inter", sans-serif',
  '--nomad-border-radius': '8px',
};

const agencyLabels = {
  title: 'Agency Fire Modeling',
  tabs: {
    models: 'Simulations',
    drafts: 'In Progress',
    jobs: 'Running',
  },
  buttons: {
    newModel: 'New Simulation',
  },
};

export function BrandedDashboard() {
  return (
    <NomadProvider
      theme={agencyTheme}
      labels={agencyLabels}
      features={{ export: true, compare: false }}
    >
      <OpenNomadProvider adapter={adapter}>
        <DashboardContainer mode="embedded" />
      </OpenNomadProvider>
    </NomadProvider>
  );
}
```

### Auth Token Refresh

```tsx
import { useState, useEffect, useMemo } from 'react';
import { OpenNomadProvider, DashboardContainer } from '@nomad/frontend';

export function DashboardWithTokenRefresh() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Initial token fetch
    fetchToken().then(setToken);

    // Refresh every 10 minutes
    const interval = setInterval(async () => {
      const newToken = await refreshToken();
      setToken(newToken);
    }, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const adapter = useMemo(
    () => token ? createAdapter(token) : null,
    [token]
  );

  if (!adapter) return <div>Loading...</div>;

  return (
    <OpenNomadProvider adapter={adapter}>
      <DashboardContainer mode="embedded" />
    </OpenNomadProvider>
  );
}
```

## API Quick Reference

The adapter must implement 6 modules:

| Module | Purpose | Key Methods |
|--------|---------|-------------|
| `auth` | User authentication | `getCurrentUser()`, `getAuthToken()`, `onAuthChange()` |
| `models` | Fire model CRUD | `create()`, `list()`, `get()`, `update()`, `delete()` |
| `jobs` | Job execution | `submit()`, `cancel()`, `getStatus()`, `onStatusChange()` |
| `results` | Output retrieval | `get()`, `getData()`, `export()`, `getPreviewUrl()` |
| `spatial` | Map + data services | `drawPoint()`, `addLayer()`, `getWeatherStations()` |
| `config` | System config | `getAvailableEngines()`, `getAgencyConfig()` |

## White-Label Customization

The `NomadProvider` component enables deep customization:

### Theme (CSS Custom Properties)

```typescript
const theme: NomadTheme = {
  '--nomad-primary': '#1976d2',
  '--nomad-background': '#f5f5f5',
  '--nomad-font-family': '"Roboto", sans-serif',
};
```

### Labels (i18n / Branding)

```typescript
const labels: NomadLabels = {
  title: 'Fire Modeling Dashboard',
  tabs: { models: 'Models', drafts: 'Drafts', jobs: 'Jobs' },
  buttons: { newModel: 'New Model', export: 'Export' },
  emptyStates: { noModels: 'No models found' },
};
```

### Custom Actions

```typescript
const actions: NomadAction[] = [{
  id: 'agency-export',
  label: 'Export to Agency System',
  placement: 'toolbar',
  onClick: () => exportToAgencySystem(),
}];
```

### Component Slots

```typescript
const slots: NomadSlots = {
  header: (defaults) => <><AgencyLogo />{defaults}</>,
  footer: () => <AgencyFooter />,
};
```

### Feature Flags

```typescript
const features: NomadFeatures = {
  export: true,
  compare: false,
  drafts: true,
  jobs: true,
  delete: false,
};
```

## Detailed Documentation

| Document | Description |
|----------|-------------|
| [openNomad/README.md](frontend/src/openNomad/README.md) | Complete adapter implementation guide |
| [openNomad/api.ts](frontend/src/openNomad/api.ts) | Full API interface with JSDoc |
| [ExampleAgencyAdapter.ts](frontend/src/openNomad/examples/ExampleAgencyAdapter.ts) | Copy-and-customize adapter template |
| [EmbeddedIntegration.tsx](frontend/src/openNomad/examples/EmbeddedIntegration.tsx) | React integration patterns |
| [customization/types.ts](frontend/src/openNomad/customization/types.ts) | White-label type definitions |

## Runnable Examples

See `docs/examples/` for complete, runnable integration examples:

- `react-minimal/` - Minimal React integration
- `vanilla-js/` - UMD/script tag approach

## Peer Dependencies

The dashboard requires React 18+:

```json
{
  "peerDependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

## Support

- GitHub Issues: [WISE-Developers/project_nomad](https://github.com/WISE-Developers/project_nomad/issues)
