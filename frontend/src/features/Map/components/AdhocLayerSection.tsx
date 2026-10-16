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
import React, { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
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
import { useMap } from '../context/MapContext';
import { assessScaleVisibility, scaleDenominatorFor } from '../utils/scaleVisibility.js';
import { AddAdhocLayerForm, type AdhocLayerScope } from './AddAdhocLayerForm.js';

/**
 * Inline styles, because LayerPanel styles everything inline and ships no
 * stylesheet for these class names. The first live look at this section showed
 * it unstyled and overlapping the layer list — the classNames below are kept
 * only as hooks for tests and future CSS, they carry no appearance.
 *
 * Values copied from LayerPanel's own cfsSection styles so the section sits in
 * the panel as a peer of CFS and CWFIS rather than as something bolted on.
 */
const sectionStyle: React.CSSProperties = {
  borderTop: '1px solid #eee',
  padding: '8px',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '6px',
  padding: '6px 8px',
};

const headingStyle: React.CSSProperties = {
  margin: 0,
  fontWeight: 600,
  fontSize: '12px',
  color: '#555',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const smallButtonStyle: React.CSSProperties = {
  fontSize: '11px',
  padding: '3px 8px',
  border: '1px solid #ddd',
  borderRadius: '4px',
  background: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/**
 * TWO DEDICATED LINES PER ROW: the name on one, the controls on the other, and
 * never shared (#456, Franco's ruling).
 *
 * This was one `display: flex` with `flexWrap: 'wrap'` holding the name, the
 * scope label and every button as siblings, with the name taking
 * `flex: 1 1 auto`. The wrap point was therefore a function of the layer's NAME
 * LENGTH plus the scope text, so no two rows agreed — and the button count
 * varies by design, since shared layers get Hide and only the creator gets
 * Delete.
 *
 * THE HAZARD, NOT THE LOOK: a stray Delete sitting under the wrong row reads as
 * belonging to the layer below it. In a panel used while a fire is running, a
 * delete button whose owner is ambiguous is the part that matters. With a fixed
 * structure, name length cannot move anything and every control sits on a line
 * belonging unambiguously to the layer named directly above it.
 */
const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  padding: '6px 8px',
  fontSize: '13px',
  // EXPLICIT, not inherited. An ancestor sets `color: #eee`, so these rows
  // rendered near-white on white — the layer name was effectively invisible in
  // the running panel while every test passed. Matches the CWFIS labels.
  color: '#1f2937',
};

/** The name line: the layer name, with its scope label to the right. */
const nameLineStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '6px',
  minWidth: 0,
};

const nameStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/**
 * The control line. Wraps only if the buttons themselves cannot fit, which no
 * longer depends on how long the layer is called.
 */
const controlsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
};

const scopeStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#777',
  whiteSpace: 'nowrap',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const errorStyle: React.CSSProperties = {
  margin: '4px 8px',
  fontSize: '12px',
  color: '#b00020',
  lineHeight: 1.35,
};

const emptyStyle: React.CSSProperties = {
  margin: '4px 8px',
  fontSize: '12px',
  color: '#777',
};

const formRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  padding: '4px 8px',
  color: '#1f2937',
};

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
  const { map, isLoaded: mapReady } = useMap();

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

  /**
   * A layer that cannot draw at the current scale (#448).
   *
   * Kept apart from `actionError` deliberately: nothing failed. The layer was
   * added, the server will answer, and the answer will be an empty image. That
   * is a fact about the VIEW, not an error, and rendering it as one would train
   * people to dismiss it.
   */
  const [scaleNotice, setScaleNotice] = useState<string | null>(null);

  const handleAddToMap = useCallback(
    (layer: AdhocLayerDefinition) => {
      // Warn, then add anyway. The user chose this layer deliberately and it is
      // correct at a closer zoom; refusing it would be the opaque disappearance
      // this feature guards against elsewhere.
      if (map) {
        const assessment = assessScaleVisibility(
          scaleDenominatorFor(map.getZoom(), map.getCenter().lat),
          layer,
        );
        setScaleNotice(assessment.visible ? null : (assessment.reason ?? null));
      }

      const url = buildWmsTileUrl({
        serviceUrl: layer.serviceUrl,
        layer: layer.layerName,
        version: layer.wmsVersion as '1.1.1' | '1.3.0',
      });

      addRasterLayer({
        id: layer.id,
        name: layer.name,
        // So the legend prompt can tell a missing legend from a layer that is
        // simply not drawing at this scale (#449 is gated on #448).
        ...(layer.minScaleDenominator !== undefined
          ? { minScaleDenominator: layer.minScaleDenominator }
          : {}),
        ...(layer.maxScaleDenominator !== undefined
          ? { maxScaleDenominator: layer.maxScaleDenominator }
          : {}),
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
    [addRasterLayer, map],
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
    <div className="adhoc-layer-section" style={sectionStyle}>
      <div className="adhoc-layer-section__header" style={headerStyle}>
        <h4 style={headingStyle}>Ad-hoc layers</h4>
        <button type="button" style={smallButtonStyle} onClick={() => setAdding((open) => !open)}>
          {adding ? 'Cancel' : 'Add WMS layer'}
        </button>
      </div>

      {adding && <AddAdhocLayerForm onAdded={handleAdded} onCancel={() => setAdding(false)} />}

      {listError !== null && (
        <p role="alert" className="adhoc-layer-section__error" style={errorStyle}>
          {`Could not read the shared layer list: ${listError}. ` +
            `Layers kept on this browser are still shown.`}
        </p>
      )}

      {actionError !== null && (
        <p role="alert" className="adhoc-layer-section__error" style={errorStyle}>
          {actionError}
        </p>
      )}

      {scaleNotice !== null && (
        <p
          role="status"
          className="adhoc-layer-section__scale-notice"
          style={{
            margin: '6px 0',
            padding: '6px 8px',
            fontSize: '12px',
            lineHeight: 1.4,
            color: '#7a4b00',
            background: '#fff6e5',
            border: '1px solid #f0c678',
            borderRadius: '3px',
          }}
        >
          {scaleNotice}
        </p>
      )}

      {visibleRows.length === 0 && listError === null && (
        <p className="adhoc-layer-section__empty" style={emptyStyle}>No ad-hoc layers yet.</p>
      )}

      <ul className="adhoc-layer-section__list" style={listStyle}>
        {visibleRows.map((row) => (
          <li key={`${row.scope}-${row.layer.id}`} style={rowStyle}>
            {/* Line 1: what the layer IS. No controls live here (#456). */}
            <div className="adhoc-layer-section__name-line" style={nameLineStyle}>
              <span style={nameStyle}>{row.layer.name}</span>
              <span className="adhoc-layer-section__scope" style={scopeStyle}>
                {row.scope === 'private' ? 'Private' : `Shared${row.createdBy ? ` · ${row.createdBy}` : ''}`}
              </span>
            </div>

            {/* Line 2: what you can DO to it. No layer name lives here, so a
                button can never appear to belong to a neighbouring row. */}
            <div className="adhoc-layer-section__controls" style={controlsStyle}>
            {/*
              Disabled until the map can actually take a layer (#451).
              `addRasterLayer` opens `if (!map || !isLoaded) return;` — correct
              about the world, and silent about it. A click in that window was
              discarded with no layer, no error and no explanation, which is
              indistinguishable from one that worked. The panel renders before
              the map is ready, so this is exactly when people click.
            */}
            <button
              type="button"
              style={smallButtonStyle}
              aria-label={`Add ${row.layer.name} to map`}
              disabled={!mapReady}
              title={mapReady ? undefined : 'The map is still loading — this will be available in a moment.'}
              onClick={() => handleAddToMap(row.layer)}
            >
              Add to map
            </button>

            {row.scope === 'shared' && (
              <button
                type="button"
                style={smallButtonStyle}
                aria-label={`Hide ${row.layer.name} from my map`}
                onClick={() => handleHide(row.layer)}
              >
                Hide
              </button>
            )}

            {canDelete(row) && (
              <button
                type="button"
                style={smallButtonStyle}
                aria-label={`Delete ${row.layer.name}`}
                onClick={() => void handleDelete(row)}
              >
                Delete
              </button>
            )}
            </div>
          </li>
        ))}
      </ul>

      {hiddenRows.length > 0 && (
        <div className="adhoc-layer-section__hidden" style={formRowStyle}>
          {/* A one-way hide is a layer the user can never get back without
              knowing about localStorage. */}
          <button type="button" style={smallButtonStyle} onClick={() => setShowHidden((open) => !open)}>
            {`${hiddenRows.length} hidden`}
          </button>

          {showHidden && (
            <ul>
              {hiddenRows.map((row) => (
                <li key={row.layer.id}>
                  <span style={nameStyle}>{row.layer.name}</span>
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
