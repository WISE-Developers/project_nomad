/**
 * Adding a layer that is ALREADY on the map must not duplicate its row (#315
 * follow-up).
 *
 * Found on the live CIFFC demo, 2026-10-16. `nomad-layers` held
 * `adhoc-7f25bad0…` twice with the SAME id, and the layer panel showed "M3 Fire
 * Perimeter Estimate" twice.
 *
 * The cause is a guard that covers half the operation. `addRasterLayer` checks
 * the map before touching it —
 *
 *   if (!map.getSource(config.id)) { map.addSource(...) }
 *   if (!map.getLayer(config.id))  { map.addLayer(...) }
 *
 * — and then appends to state unconditionally:
 *
 *   layers: [...prev.layers, layerConfig]
 *
 * So pressing "Add to map" a second time leaves the MAP correct and the LIST
 * wrong. That asymmetry is why nothing looked broken: the map is the thing
 * people watch, and the duplicate only shows up in the panel beside it.
 *
 * The merge is extracted here as a pure function because the provider needs a
 * maplibre instance to test and this logic does not. Keeping it pure is also
 * what makes the second-press case cheap to assert at all.
 */
import { describe, it, expect } from 'vitest';
import { upsertLayer } from '../upsertLayer.js';
import type { LayerConfig } from '../../types/layer.js';

const raster = (id: string, over: Partial<LayerConfig> = {}): LayerConfig =>
  ({
    id,
    name: id,
    type: 'raster',
    url: `https://example.org/wms?layers=${id}`,
    opacity: 1,
    visible: true,
    zIndex: 0,
    ...over,
  }) as LayerConfig;

describe('upsertLayer', () => {
  it('appends a layer that is not present — the control', () => {
    const result = upsertLayer([raster('a')], raster('b'));
    expect(result.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('does NOT duplicate a layer whose id is already present', () => {
    const result = upsertLayer([raster('a'), raster('b')], raster('b'));
    expect(result.map((l) => l.id)).toEqual(['a', 'b']);
    expect(result.filter((l) => l.id === 'b')).toHaveLength(1);
  });

  it('replaces the existing entry rather than ignoring the new one', () => {
    // A re-add carries a freshly built tile url. Silently keeping the old
    // config would strand the layer on a stale url — which is exactly how the
    // duplicate-request defect would have survived a re-add after its fix.
    const before = [raster('a'), raster('b', { name: 'old', opacity: 0.2 })];
    const result = upsertLayer(before, raster('b', { name: 'new', opacity: 1 }));
    expect(result).toHaveLength(2);
    const b = result.find((l) => l.id === 'b');
    expect(b?.name).toBe('new');
    expect(b?.opacity).toBe(1);
  });

  it('keeps the existing POSITION when replacing', () => {
    // Re-adding must not jump a layer to the top of the panel: z-order and
    // panel order are what the operator reads during an incident.
    const before = [raster('a'), raster('b'), raster('c')];
    const result = upsertLayer(before, raster('b', { name: 'new' }));
    expect(result.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the array it was given', () => {
    const before = [raster('a')];
    const copy = [...before];
    upsertLayer(before, raster('b'));
    expect(before).toEqual(copy);
  });

  it('repeated adds converge — pressing the button five times leaves one row', () => {
    let layers: LayerConfig[] = [];
    for (let i = 0; i < 5; i++) {
      layers = upsertLayer(layers, raster('b'));
    }
    expect(layers).toHaveLength(1);
  });
});
