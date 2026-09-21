/**
 * Point maplibre at a worker URL our bundler actually emits — refs #372.
 *
 * maplibre 6 no longer inlines its tile worker. It ships `maplibre-gl-worker.mjs`
 * as a separate ES module and resolves the URL from `import.meta.url`:
 *
 *     new Worker(url, { type: 'module' })
 *
 * Neither of Vite's two modes leaves that URL pointing anywhere real:
 *
 *  - dev: dependency pre-bundling rewrites `import.meta.url` into
 *    `node_modules/.vite/deps/`, where the worker file does not exist
 *  - build: maplibre is bundled into an app chunk and the worker is never
 *    emitted as an asset
 *
 * Either way the worker 404s, no tile is ever requested, and the map stays
 * blank with NO error of any kind — maplibre does not yet surface worker load
 * failures (upstream maplibre-gl-js#8018, unreleased at time of writing). The
 * style, TileJSON and sprites all load fine, because those are main-thread
 * work, which makes the failure look like a rendering problem rather than a
 * worker problem.
 *
 * `?worker&url` asks Vite to bundle the worker properly — resolving its own
 * import of `maplibre-gl-shared.mjs` — and hand back a URL that exists in both
 * modes. `setWorkerUrl` is maplibre's supported hook for exactly this.
 *
 * Import this module before constructing any Map.
 */
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);
