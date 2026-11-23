/**
 * Load maplibre-gl on demand instead of at module import — #567.
 *
 * openNomad is a LIBRARY. Importing `maplibre-gl` at module scope meant every
 * embedded consumer downloaded and evaluated MapLibre on page load even when it
 * never created a Nomad map, which pinned EasyMap 3 to `mapbox-gl` 3.31.0 (two
 * map libraries on one page is the conflict) and held that pin hostage to the
 * next Mapbox security release. EM3 #1009.
 *
 * THIS DEFERS, IT DOES NOT REMOVE. MapLibre is genuinely required by
 * `MapContainer` and `OutputPreviewModal`, both reachable from
 * `DashboardContainer`, so `maplibre-gl` stays a REQUIRED peerDependency — see
 * src/__tests__/libExternalsPeerContract.convention.test.ts for why `optional`
 * would be worse than useless here.
 *
 * `setWorkerUrl` used to run at module scope in maplibreWorker.ts, which is
 * precisely the import-time side effect that cost us this. It now runs once,
 * on first load, inside this module. The worker URL itself is a Vite-emitted
 * asset path — a string, not the library — so importing it statically costs a
 * consumer nothing.
 *
 * NO STYLESHEET IS IMPORTED HERE, deliberately. The library emits no CSS at all
 * (#387, pinned by scripts/__tests__/lib_bundle_no_css.test.sh); map chrome
 * styling belongs to whoever renders the map. Nomad's own SAN entry point
 * (src/main.tsx) imports it for itself.
 */
import type * as MapLibreGL from 'maplibre-gl';
/**
 * Point maplibre at a worker URL our bundler actually emits — refs #372. This
 * import and the `setWorkerUrl` call below were `maplibreWorker.ts`, which this
 * module replaces; the reasoning is kept because the failure it prevents is
 * invisible and we paid for it once already.
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
 */
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export type MapLibre = typeof MapLibreGL;

/** Resolved module, once loaded. Read synchronously via `getLoadedMaplibre`. */
let loaded: MapLibre | null = null;

/**
 * The in-flight load. Cached so that N components mounting at once share ONE
 * network request and ONE `setWorkerUrl` call, rather than racing.
 */
let inFlight: Promise<MapLibre> | null = null;

/**
 * Load maplibre-gl, configuring its worker on first call.
 *
 * Rejects if the module cannot be resolved — which is the correct behaviour for
 * a missing required peer. There is no fallback: a consumer who asked for a map
 * and has no maplibre installed has a broken install, and hiding that behind a
 * blank map is exactly the failure mode #372 took two days to find.
 */
export function loadMaplibre(): Promise<MapLibre> {
  if (loaded) return Promise.resolve(loaded);

  if (!inFlight) {
    inFlight = import('maplibre-gl').then((mod) => {
      // maplibre-gl's ESM entry exposes its API as named exports, so the module
      // namespace IS the shape the old `import * as maplibregl` produced.
      const maplibregl = mod as unknown as MapLibre;
      maplibregl.setWorkerUrl(workerUrl);
      loaded = maplibregl;
      return maplibregl;
    });
  }

  return inFlight;
}

/**
 * The already-loaded module, or null.
 *
 * For SYNCHRONOUS call sites that cannot await — a maplibre event handler, or an
 * effect that attaches one. Those only ever run once a map exists, and a map
 * only exists because a map-creating path already awaited `loadMaplibre`, so by
 * then this is non-null. Returning null is therefore not a fallback hiding a
 * failure: it means no map was ever created and there is nothing to decorate.
 */
export function getLoadedMaplibre(): MapLibre | null {
  return loaded;
}
