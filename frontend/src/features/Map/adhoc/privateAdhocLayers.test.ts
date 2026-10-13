/**
 * #315a — the per-user half of ad-hoc layers.
 *
 * Papa's ruling: a **private checkbox** decides storage. Private means the
 * layer never reaches the server, so this module is the whole persistence
 * story for it — there is no row anywhere else to fall back on.
 *
 * It holds two things, and they belong together because both answer "what does
 * THIS user see?":
 *
 *   1. private layers — this user's own, never shared
 *   2. the ids of SHARED layers this user has hidden from their own map
 *
 * (2) is the counterpart to creator-only delete. Everyone can hide a shared
 * layer for themselves; only its author removes it for everyone. So "hidden"
 * is per-user state about someone else's row, which is exactly what local
 * storage is for.
 *
 * ON STORAGE BEING UNAVAILABLE — a private window, or a browser set to block
 * site data. `shared/utils/storage` already returns null/false rather than
 * throwing, and this module must not convert that into a crash: a layer panel
 * that dies in a private window takes the whole map with it. But it must not
 * lie either. A write that did not persist returns **false**, so the form can
 * tell the user their layer was not saved. Reporting success for a write that
 * went nowhere is the silent default this house refuses.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  listPrivateLayers,
  addPrivateLayer,
  removePrivateLayer,
  listHiddenSharedIds,
  hideSharedLayer,
  unhideSharedLayer,
  isSharedLayerHidden,
  PRIVATE_LAYERS_KEY,
  HIDDEN_SHARED_KEY,
} from './privateAdhocLayers.js';
import type { AdhocLayerDefinition } from './privateAdhocLayers.js';

const BC_RIVERS: AdhocLayerDefinition = {
  id: 'adhoc-private-1',
  name: 'BC Hydrography',
  serviceUrl: 'https://openmaps.gov.bc.ca/geo/pub/wms',
  layerName: 'pub:WHSE_WATER.FWA_RIVERS_POLY',
  wmsVersion: '1.3.0',
};

const NTS_GRID: AdhocLayerDefinition = {
  id: 'adhoc-private-2',
  name: 'NTS 50k Grid',
  serviceUrl: 'https://openmaps.gov.bc.ca/geo/pub/wms',
  layerName: 'pub:WHSE_BASEMAPPING.NTS_50K_GRID',
  wmsVersion: '1.3.0',
  legendUrl: 'https://openmaps.gov.bc.ca/geo/pub/wms?request=GetLegendGraphic',
};

describe('private ad-hoc layers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('the control: an empty store', () => {
    it('reports no private layers rather than failing', () => {
      expect(listPrivateLayers()).toEqual([]);
    });

    it('reports nothing hidden', () => {
      expect(listHiddenSharedIds()).toEqual([]);
      expect(isSharedLayerHidden('anything')).toBe(false);
    });
  });

  describe('keeping a private layer', () => {
    it('stores it and reads it back whole', () => {
      expect(addPrivateLayer(BC_RIVERS)).toBe(true);

      const stored = listPrivateLayers();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual(BC_RIVERS);
    });

    it('keeps several, in the order they were added', () => {
      addPrivateLayer(BC_RIVERS);
      addPrivateLayer(NTS_GRID);

      expect(listPrivateLayers().map((l) => l.id)).toEqual([BC_RIVERS.id, NTS_GRID.id]);
    });

    it('does not reach the network or any server', () => {
      // The whole meaning of "private" is this. If a fetch ever appears in
      // this module, the checkbox has stopped telling the truth.
      const spy = vi.fn();
      vi.stubGlobal('fetch', spy);

      addPrivateLayer(BC_RIVERS);
      listPrivateLayers();

      expect(spy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it('replaces a layer re-added under the same id instead of duplicating it', () => {
      addPrivateLayer(BC_RIVERS);
      addPrivateLayer({ ...BC_RIVERS, name: 'BC Hydrography (renamed)' });

      const stored = listPrivateLayers();
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe('BC Hydrography (renamed)');
    });

    it('removes one and leaves the rest', () => {
      addPrivateLayer(BC_RIVERS);
      addPrivateLayer(NTS_GRID);

      expect(removePrivateLayer(BC_RIVERS.id)).toBe(true);
      expect(listPrivateLayers().map((l) => l.id)).toEqual([NTS_GRID.id]);
    });

    it('reports false when asked to remove something that was never there', () => {
      // "I removed nothing" and "I removed it" must not look the same to the
      // caller — a panel that reports success for a no-op hides a real bug.
      expect(removePrivateLayer('never-existed')).toBe(false);
    });
  });

  describe('hiding a SHARED layer, for me only', () => {
    it('records the id and answers for it', () => {
      expect(hideSharedLayer('shared-7')).toBe(true);

      expect(isSharedLayerHidden('shared-7')).toBe(true);
      expect(listHiddenSharedIds()).toEqual(['shared-7']);
    });

    it('does not hide a layer that was never hidden', () => {
      hideSharedLayer('shared-7');
      expect(isSharedLayerHidden('shared-8')).toBe(false);
    });

    it('hides the same id once, not twice', () => {
      hideSharedLayer('shared-7');
      hideSharedLayer('shared-7');
      expect(listHiddenSharedIds()).toEqual(['shared-7']);
    });

    it('unhides', () => {
      hideSharedLayer('shared-7');
      expect(unhideSharedLayer('shared-7')).toBe(true);
      expect(isSharedLayerHidden('shared-7')).toBe(false);
    });

    it('keeps hiding separate from deleting — the shared row is untouched', () => {
      // Hiding is this user's preference about someone else's layer. It writes
      // only here; nothing in this module can remove a shared row.
      hideSharedLayer('shared-7');
      expect(listPrivateLayers()).toEqual([]);
    });
  });

  describe('when storage is unavailable or corrupt', () => {
    it('reports a failed write as FALSE rather than claiming success', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

      expect(addPrivateLayer(BC_RIVERS)).toBe(false);
    });

    it('still renders an empty list when reads throw', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });

      // The panel must come up. An empty list is honest here: we genuinely
      // cannot see any private layers.
      expect(() => listPrivateLayers()).not.toThrow();
      expect(listPrivateLayers()).toEqual([]);
      expect(() => listHiddenSharedIds()).not.toThrow();
    });

    it('survives a corrupt value written by something else', () => {
      localStorage.setItem(PRIVATE_LAYERS_KEY, 'not json at all');
      localStorage.setItem(HIDDEN_SHARED_KEY, '{"not":"an array"}');

      expect(listPrivateLayers()).toEqual([]);
      expect(listHiddenSharedIds()).toEqual([]);
    });

    it('discards a stored entry that is not a usable layer', () => {
      // Shape drift: an older build, or a hand-edited value. A layer missing
      // its serviceUrl would render a row that can never draw a tile.
      localStorage.setItem(
        PRIVATE_LAYERS_KEY,
        JSON.stringify({
          data: [BC_RIVERS, { id: 'broken', name: 'No service url' }],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      );

      const stored = listPrivateLayers();
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe(BC_RIVERS.id);
    });
  });
});
