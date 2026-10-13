/**
 * #315d — the ad-hoc layers section of the layer panel.
 *
 * Its own component rather than more lines inside `LayerPanel`, which is
 * already 601 lines of hardcoded CFS/CWFIS sections. The panel renders this
 * and nothing else changes there, so the feature can be read, tested and
 * removed in one piece.
 *
 * PAPA'S LAST TWO RULINGS LIVE HERE:
 *
 *  - Every user may **hide** a shared layer from their own map. That writes to
 *    this browser only; the shared row is untouched.
 *  - Only the **creator** may delete it for everyone. A non-creator is not
 *    offered the button at all — a control that can only ever 403 teaches
 *    users to distrust the UI — but the server stays the authority, and if it
 *    refuses anyway its message is shown verbatim, because that message names
 *    the owner and points at hiding instead.
 *
 * *"It disappeared and I do not know why"* is worse during an incident than
 * *"it is wrong and I have hidden it."* That is the whole reason these two
 * actions are separate.
 *
 * WMS IS NOT A NEW LAYER KIND. It reaches the map through the same
 * `addRasterLayer` as every other raster, as a `RasterLayerConfig` with
 * `legendType: 'wms'` — the path CWFIS M3 already takes (#299) — and its tile
 * url comes from `buildWmsTileUrl`, never assembled here. A second url builder
 * is how two code paths drift apart.
 */
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import {
  listAdhocLayers,
  deleteAdhocLayer,
  type AdhocLayerResponse,
} from '../../../services/api.js';
import {
  listPrivateLayers,
  removePrivateLayer,
  listHiddenSharedIds,
  hideSharedLayer,
  unhideSharedLayer,
  type AdhocLayerDefinition,
} from '../adhoc/privateAdhocLayers.js';
import { buildWmsTileUrl, buildWmsLegendUrl } from '../utils/wmsUrl.js';
import { useLayers } from '../context/useLayers';
import { AddAdhocLayerForm, type AdhocLayerScope } from './AddAdhocLayerForm.js';

export interface AdhocLayerSectionProps {
  /**
   * The signed-in user, as the backend records `created_by`. `null` under
   * NOMAD_AUTH_MODE=none, where nothing is attributable and so nothing is
   * deletable through this panel.
   */
  currentUser: string | null;
}

type Scope = AdhocLayerScope;

interface Row {
  readonly layer: AdhocLayerDefinition;
  readonly scope: Scope;
  /** Shared rows only; null when unattributable. */
  readonly createdBy: string | null;
}

function toDefinition(row: AdhocLayerResponse): AdhocLayerDefinition {
  return {
    id: row.id,
    name: row.name,
    serviceUrl: row.serviceUrl,
    layerName: row.layerName,
    wmsVersion: row.wmsVersion,
    legendUrl: row.legendUrl,
  };
}

function messageFrom(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}

export function AdhocLayerSection({ currentUser }: AdhocLayerSectionProps): JSX.Element {
  const { addRasterLayer, removeLayer } = useLayers();

  const [shared, setShared] = useState<AdhocLayerResponse[]>([]);
  const [privateLayers, setPrivateLayers] = useState<AdhocLayerDefinition[]>(() =>
    listPrivateLayers(),
  );
  const [hiddenIds, setHiddenIds] = useState<string[]>(() => listHiddenSharedIds());
  const [showHidden, setShowHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  /**
   * Why the shared list is empty, when it is.
   *
   * `null` means we asked and there were none. A string means we could not
   * ask. Those are different facts and the backend and API client each keep
   * them apart; this is the last place the pair can be collapsed.
   */
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshShared = useCallback(async () => {
    try {
      const result = await listAdhocLayers();
      setShared(result.layers);
      setListError(null);
    } catch (caught) {
      // Private layers do not depend on the server, so they stay listed. A
      // user's own data must not vanish because something else is down.
      setShared([]);
      setListError(messageFrom(caught));
    }
  }, []);

  useEffect(() => {
    void refreshShared();
  }, [refreshShared]);

  const visibleRows = useMemo<Row[]>(() => {
    const sharedRows: Row[] = shared
      .filter((row) => !hiddenIds.includes(row.id))
      .map((row) => ({ layer: toDefinition(row), scope: 'shared', createdBy: row.createdBy }));

    const privateRows: Row[] = privateLayers.map((layer) => ({
      layer,
      scope: 'private',
      createdBy: currentUser,
    }));

    return [...sharedRows, ...privateRows];
  }, [shared, privateLayers, hiddenIds, currentUser]);

  const hiddenRows = useMemo<Row[]>(
    () =>
      shared
        .filter((row) => hiddenIds.includes(row.id))
        .map((row) => ({ layer: toDefinition(row), scope: 'shared', createdBy: row.createdBy })),
    [shared, hiddenIds],
  );

  const handleAddToMap = useCallback(
    (layer: AdhocLayerDefinition) => {
      const url = buildWmsTileUrl({
        serviceUrl: layer.serviceUrl,
        layer: layer.layerName,
        version: layer.wmsVersion as '1.1.1' | '1.3.0',
      });

      addRasterLayer({
        id: layer.id,
        name: layer.name,
        url,
        tileSize: 256,
        opacity: 1,
        visible: true,
        zIndex: 0,
        legendType: 'wms',
        legendUrl:
          layer.legendUrl ??
          buildWmsLegendUrl({
            serviceUrl: layer.serviceUrl,
            layer: layer.layerName,
            version: layer.wmsVersion as '1.1.1' | '1.3.0',
          }),
      });
    },
    [addRasterLayer],
  );

  /** Hide a SHARED layer for this user only. The shared row is not touched. */
  const handleHide = useCallback(
    (layer: AdhocLayerDefinition) => {
      if (!hideSharedLayer(layer.id)) {
        setActionError(
          'This layer could not be hidden — your browser is not storing site data.',
        );
        return;
      }
      setHiddenIds(listHiddenSharedIds());
      // It is off the list, so it comes off the map too; leaving it drawn
      // while absent from the panel is the opaque disappearance in reverse.
      removeLayer(layer.id);
    },
    [removeLayer],
  );

  const handleRestore = useCallback((layer: AdhocLayerDefinition) => {
    unhideSharedLayer(layer.id);
    setHiddenIds(listHiddenSharedIds());
  }, []);

  const handleDelete = useCallback(
    async (row: Row) => {
      setActionError(null);

      if (row.scope === 'private') {
        removePrivateLayer(row.layer.id);
        setPrivateLayers(listPrivateLayers());
        removeLayer(row.layer.id);
        return;
      }

      try {
        await deleteAdhocLayer(row.layer.id);
        removeLayer(row.layer.id);
        await refreshShared();
      } catch (caught) {
        // Verbatim: the server's 403 names the owner and says hiding is
        // available instead. Replacing it with "delete failed" loses both.
        setActionError(messageFrom(caught));
      }
    },
    [removeLayer, refreshShared],
  );

  const handleAdded = useCallback(
    (layer: AdhocLayerDefinition, scope: Scope) => {
      setAdding(false);
      if (scope === 'private') {
        setPrivateLayers(listPrivateLayers());
      } else {
        void refreshShared();
      }
      // Added means on the map: a user who just added a layer and sees nothing
      // has no way to tell whether it worked.
      handleAddToMap(layer);
    },
    [refreshShared, handleAddToMap],
  );

  /** Only the creator deletes a shared layer, and only when attributable. */
  const canDelete = (row: Row): boolean =>
    row.scope === 'private' || (currentUser !== null && row.createdBy === currentUser);

  return (
    <div className="adhoc-layer-section">
      <div className="adhoc-layer-section__header">
        <h4>Ad-hoc layers</h4>
        <button type="button" onClick={() => setAdding((open) => !open)}>
          {adding ? 'Cancel' : 'Add WMS layer'}
        </button>
      </div>

      {adding && <AddAdhocLayerForm onAdded={handleAdded} onCancel={() => setAdding(false)} />}

      {listError !== null && (
        <p role="alert" className="adhoc-layer-section__error">
          {`Could not read the shared layer list: ${listError}. ` +
            `Layers kept on this browser are still shown.`}
        </p>
      )}

      {actionError !== null && (
        <p role="alert" className="adhoc-layer-section__error">
          {actionError}
        </p>
      )}

      {visibleRows.length === 0 && listError === null && (
        <p className="adhoc-layer-section__empty">No ad-hoc layers yet.</p>
      )}

      <ul className="adhoc-layer-section__list">
        {visibleRows.map((row) => (
          <li key={`${row.scope}-${row.layer.id}`}>
            <span>{row.layer.name}</span>
            <span className="adhoc-layer-section__scope">
              {row.scope === 'private' ? 'Private' : `Shared${row.createdBy ? ` · ${row.createdBy}` : ''}`}
            </span>

            <button
              type="button"
              aria-label={`Add ${row.layer.name} to map`}
              onClick={() => handleAddToMap(row.layer)}
            >
              Add to map
            </button>

            {row.scope === 'shared' && (
              <button
                type="button"
                aria-label={`Hide ${row.layer.name} from my map`}
                onClick={() => handleHide(row.layer)}
              >
                Hide
              </button>
            )}

            {canDelete(row) && (
              <button
                type="button"
                aria-label={`Delete ${row.layer.name}`}
                onClick={() => void handleDelete(row)}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      {hiddenRows.length > 0 && (
        <div className="adhoc-layer-section__hidden">
          {/* A one-way hide is a layer the user can never get back without
              knowing about localStorage. */}
          <button type="button" onClick={() => setShowHidden((open) => !open)}>
            {`${hiddenRows.length} hidden`}
          </button>

          {showHidden && (
            <ul>
              {hiddenRows.map((row) => (
                <li key={row.layer.id}>
                  <span>{row.layer.name}</span>
                  <button
                    type="button"
                    aria-label={`Restore ${row.layer.name}`}
                    onClick={() => handleRestore(row.layer)}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
