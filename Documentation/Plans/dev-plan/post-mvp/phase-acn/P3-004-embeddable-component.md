# P3-004: Embeddable React Component

**GitHub Milestone**: [P3-004: Embeddable React Component](https://github.com/WISE-Developers/project_nomad/milestone/12)

## Overview

Package the Nomad frontend as an embeddable React component that agencies can integrate into their existing applications. In ACN mode, the agency's "host" application wraps Nomad rather than Nomad being a standalone app.

## Tasks

### P3-004-01: Component Entry Point

**Description**: Create the main `<Nomad />` component for embedding.

**Acceptance Criteria**:
- [ ] Create `<Nomad />` component as primary export
- [ ] Accept props: `config`, `authProvider`, `onEvent` callback
- [ ] Component renders the full Nomad UI (map, wizard, etc.)
- [ ] Component manages its own state (no Redux required in host)
- [ ] Export TypeScript types for all props
- [ ] Support `className` and `style` props for host styling

**Files to Create/Modify**:
- `frontend/src/Nomad.tsx` (main component)
- `frontend/src/types/EmbedTypes.ts`
- `frontend/src/index.ts` (exports)

**Dependencies**: P3-001-02, P3-002-04

---

### P3-004-02: Embed Configuration API

**Description**: Define the API for configuring embedded Nomad.

**Acceptance Criteria**:
- [ ] Create `NomadConfig` type for embed configuration
- [ ] Support backend URL override (host may proxy)
- [ ] Support feature flags (enable/disable features)
- [ ] Support callback hooks: `onModelComplete`, `onExport`, `onError`
- [ ] Support initial state (pre-selected location, pre-loaded model)
- [ ] Create `createNomad(config)` factory function for non-React hosts

**Files to Create/Modify**:
- `frontend/src/embed/NomadConfig.ts`
- `frontend/src/embed/createNomad.ts`
- `frontend/src/embed/index.ts`

**Dependencies**: P3-004-01

---

### P3-004-03: Library Build Configuration

**Description**: Configure build toolchain to produce embeddable library.

**Acceptance Criteria**:
- [ ] Add Vite library mode configuration
- [ ] Output UMD bundle for `<script>` tag usage
- [ ] Output ESM bundle for npm/import usage
- [ ] Externalize React, ReactDOM (host provides)
- [ ] Generate TypeScript declarations
- [ ] CSS extracted to separate file (host can override)
- [ ] Source maps for debugging

**Files to Create/Modify**:
- `frontend/vite.config.ts` (add library config)
- `frontend/package.json` (add build:lib script, exports field)
- `frontend/tsconfig.lib.json` (declaration generation)

**Dependencies**: P3-004-01

---

### P3-004-04: Component Documentation

**Description**: Create documentation for agency developers embedding Nomad.

**Acceptance Criteria**:
- [ ] Create embedding guide with code examples
- [ ] Document all props and configuration options
- [ ] Provide React example (recommended)
- [ ] Provide vanilla JS example (script tag)
- [ ] Document CSS customization approach
- [ ] Document event callbacks and their payloads
- [ ] Include troubleshooting section

**Files to Create/Modify**:
- `frontend/docs/EMBEDDING.md`
- `frontend/docs/examples/react-embed.tsx`
- `frontend/docs/examples/vanilla-embed.html`

**Dependencies**: P3-004-01 through P3-004-03

---

## Architecture Notes

### React Host Integration

```tsx
// Agency's application
import { Nomad } from '@nomad/frontend';

function AgencyApp() {
  const authProvider = useAgencyAuth(); // Their existing auth

  return (
    <div className="agency-layout">
      <AgencyHeader />
      <Nomad
        config={{
          backendUrl: '/api/nomad',  // Proxied through agency backend
          features: { export: true, review: true }
        }}
        authProvider={authProvider}
        onModelComplete={(model) => {
          // Agency-specific handling
          saveToAgencySystem(model);
        }}
      />
      <AgencyFooter />
    </div>
  );
}
```

### Vanilla JS Integration

```html
<div id="nomad-container"></div>
<script src="https://nomad.cdn/nomad.umd.js"></script>
<script>
  Nomad.create('#nomad-container', {
    backendUrl: '/api/nomad',
    auth: {
      getToken: () => localStorage.getItem('agency_token'),
      getUser: () => JSON.parse(localStorage.getItem('agency_user'))
    }
  });
</script>
```

### Build Output Structure

```
dist/
├── nomad.es.js          # ESM bundle (npm)
├── nomad.umd.js         # UMD bundle (script tag)
├── nomad.css            # Extracted styles
├── nomad.d.ts           # TypeScript declarations
└── assets/              # Images, fonts
```

## SST Alignment

From R3-nomad-frontend.md:
> **ACN Integration**: Agency Host embeds Nomad

```mermaid
AgencyHost -.->|embeds| App
```

The `<Nomad />` component is the App.tsx packaged for external consumption.
