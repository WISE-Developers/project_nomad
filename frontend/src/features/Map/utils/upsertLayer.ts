import type { LayerConfig } from '../types/layer.js';

/**
 * Add a layer to the list, replacing any entry that already carries its id.
 *
 * WHY THIS IS NOT `[...layers, config]` (#315 follow-up).
 *
 * `addRasterLayer` guards the MAP before touching it — `if (!map.getSource(id))`
 * and `if (!map.getLayer(id))` — and then appended to state unconditionally. So
 * a second press of "Add to map" left the map correct and the list wrong: on the
 * live CIFFC demo the panel showed "M3 Fire Perimeter Estimate" twice, both rows
 * carrying the same id.
 *
 * The asymmetry is why it went unnoticed. The map is the thing people watch, and
 * it looked right; the duplicate only appears in the panel beside it.
 *
 * REPLACE RATHER THAN IGNORE, because a re-add carries a freshly built tile url.
 * Ignoring the new config would strand the layer on the old one — which is how a
 * url fix would fail to take effect for anyone who re-added a layer rather than
 * reloading.
 *
 * POSITION IS PRESERVED, because panel order and z-order are what an operator
 * reads during an incident; a re-add must not jump a layer to the top.
 */
export function upsertLayer(layers: LayerConfig[], config: LayerConfig): LayerConfig[] {
  const existing = layers.findIndex((layer) => layer.id === config.id);

  if (existing === -1) {
    return [...layers, config];
  }

  const next = [...layers];
  next[existing] = config;
  return next;
}
