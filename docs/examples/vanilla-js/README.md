# Vanilla JS Integration Example

This example demonstrates how to embed the Nomad Dashboard without a build system, using plain HTML and JavaScript.

## Setup

1. Build the Nomad frontend library:
   ```bash
   cd ../../../frontend
   npm run build:lib
   ```

2. Serve the example directory:
   ```bash
   # Using Python
   python -m http.server 8080

   # Using Node.js
   npx serve .
   ```

3. Open `http://localhost:8080` in your browser.

## How It Works

### 1. Load React (Peer Dependency)

The dashboard requires React 18+, loaded from CDN:

```html
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
```

### 2. Load the Nomad UMD Bundle

```html
<script src="path/to/nomad/dist/openNomad.umd.cjs"></script>
```

### 3. Access Exports

The UMD bundle exposes everything on `window.NomadFrontend`:

```javascript
const {
  OpenNomadProvider,
  DashboardContainer,
  createAgencyAdapter,
} = window.NomadFrontend;
```

### 4. Create Elements Without JSX

Use `React.createElement` directly:

```javascript
const dashboard = React.createElement(
  OpenNomadProvider,
  { adapter: adapter },
  React.createElement(DashboardContainer, {
    mode: 'embedded',
    onLaunchWizard: handleLaunchWizard,
  })
);
```

### 5. Render

```javascript
const root = ReactDOM.createRoot(document.getElementById('container'));
root.render(dashboard);
```

## When to Use This Approach

- Legacy applications without a modern build system
- Quick prototypes or demos
- Integrating with non-JavaScript frameworks (PHP, Ruby, etc.)
- Applications that load scripts dynamically

## Production Considerations

1. **Bundle Size**: The UMD bundle includes all dependencies except React. Consider whether a build step would be more efficient.

2. **Caching**: Set appropriate cache headers for the UMD bundle.

3. **CDN**: For production, consider hosting the UMD bundle on your CDN rather than referencing local files.

4. **Security**: Ensure your auth token is retrieved securely (not hardcoded).

## See Also

- [EMBEDDING.md](../../../EMBEDDING.md) - Main embedding guide
- [react-minimal/](../react-minimal/) - React + build system example
