import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
// maplibre's own map chrome — controls, attribution, popups (#387).
//
// This lives at the SAN entry point, not in MapContainer/OutputPreviewModal, so
// it stays out of the library graph. Those two components are the only ones that
// call `new maplibregl.Map`, and neither is in the openNomad bundle — but their
// stylesheet import was retained after Rollup tree-shook their JS, putting an
// 83 kB stylesheet of unusable map chrome in every published tarball, not even
// reachable through `exports`.
//
// Embedded consumers own their own map and its styles: maplibre-gl is declared
// external in vite.lib.config.ts and LayerContext takes `map` as a parameter.
import 'maplibre-gl/dist/maplibre-gl.css';
import { initSentry, SentryErrorBoundary } from './observability/sentry';

// SAN entry point — standalone Nomad, never embedded. ACN/openNomad hosts are
// responsible for initialising their own Sentry (see observability/sentry.ts).
// No-op unless VITE_SENTRY_DSN is set (air-gapped installs stay silent).
initSentry({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  embedded: false,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_SENTRY_RELEASE,
});

const fallback = (
  <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
    <h2>Something went wrong.</h2>
    <p>The error has been reported. Please reload the page to continue.</p>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SentryErrorBoundary fallback={fallback}>
      <App />
    </SentryErrorBoundary>
  </StrictMode>
);
