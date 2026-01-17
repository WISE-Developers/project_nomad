# React Minimal Integration Example

This example demonstrates the minimal setup required to embed the Nomad Dashboard in a React application.

## Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## What This Example Shows

1. **Creating an adapter** - The adapter connects the dashboard to your backend
2. **Embedding the dashboard** - Using `OpenNomadProvider` and `DashboardContainer`
3. **Handling callbacks** - Responding to user actions like launching the wizard

## Key Components

### OpenNomadProvider

Wraps your application and provides the API adapter to all child components:

```tsx
<OpenNomadProvider adapter={adapter}>
  {/* Dashboard and other components */}
</OpenNomadProvider>
```

### DashboardContainer

The actual dashboard UI component:

```tsx
<DashboardContainer
  mode="embedded"
  onLaunchWizard={(draftId) => /* handle */}
  onViewResults={(modelId) => /* handle */}
/>
```

## Customizing the Adapter

The example uses `createAgencyAdapter` from `@nomad/frontend`, which provides a template implementation. For production, you'll want to customize this to connect to your actual backend services.

See the main [EMBEDDING.md](../../../EMBEDDING.md) guide for full adapter implementation details.
