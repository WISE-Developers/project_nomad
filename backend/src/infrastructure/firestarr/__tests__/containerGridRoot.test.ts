/**
 * The engine must be told where the rasters are (#520, fault 2).
 *
 * FireSTARR resolves `RASTER_ROOT` from its own `settings.ini`, and every published
 * image ships `RASTER_ROOT = ./grid` — i.e. `/appl/firestarr/grid`, where nothing is
 * mounted. The dataset's grids live under the mount at `/appl/data`.
 *
 * Until #515 this was patched per run by a `sed` inside a `/bin/sh` entrypoint
 * wrapper. Removing the shell was right; the rewrite went with it, and nothing
 * replaced it, so docker-mode runs failed with
 * `FATAL: Could not find an environment to use for (lat, lon)`.
 *
 * The binary accepts `--raster-root <dir>`, confirmed from its own usage output. That
 * needs no shell, no settings file mounted over the image's, and no image rebuild, so
 * it works on images that already exist.
 */
import { describe, it, expect } from 'vitest';
import { containerGridRootFrom } from '../FireSTARRInputGenerator.js';

describe('containerGridRootFrom', () => {
  it('maps a host grid root onto the container dataset mount', () => {
    expect(containerGridRootFrom('/Users/someone/localcode/firestarr_data/generated/grid/100m'))
      .toBe('/appl/data/generated/grid/100m');
  });

  it('is independent of where the dataset sits on the host', () => {
    // The host path is operator-supplied (FIRESTARR_DATASET_PATH) and the container
    // mount is fixed, so two different hosts must produce the same container path.
    expect(containerGridRootFrom('/mnt/data/generated/grid/100m'))
      .toBe(containerGridRootFrom('/srv/nomad/firestarr_data/generated/grid/100m'));
  });

  it('preserves the resolution directory rather than assuming 100m', () => {
    expect(containerGridRootFrom('/data/generated/grid/30m')).toBe('/appl/data/generated/grid/30m');
  });

  it('returns undefined when there is no grid root to map', () => {
    expect(containerGridRootFrom(undefined)).toBeUndefined();
    expect(containerGridRootFrom('')).toBeUndefined();
  });

  it('returns undefined for a path that is not under a dataset layout', () => {
    // Guessing here would send the engine at a directory that does not exist and
    // reproduce the original failure with a different path in the message.
    expect(containerGridRootFrom('/somewhere/else/grids')).toBeUndefined();
  });

  it('is already a container path when given one', () => {
    expect(containerGridRootFrom('/appl/data/generated/grid/100m'))
      .toBe('/appl/data/generated/grid/100m');
  });
});
