/**
 * #315c — add a WMS layer by hand.
 *
 * Papa's rulings, in the order a user meets them:
 *
 *  1. Paste a service url and READ it. We ask the backend, not the browser —
 *     a WMS server rarely sends CORS headers, so a browser fetch would fail
 *     against most of them for reasons the user cannot act on.
 *  2. **CHOOSE** a layer from what that server actually publishes. There is no
 *     layer-name text field in this form at all. A typed name fails as a
 *     silent empty tile, which is the worst possible failure during an
 *     incident — it looks like the fire is not there.
 *  3. Decide with the **private checkbox** where it is kept. Private never
 *     leaves this browser; shared goes to every operator on the deployment.
 *
 * The checkbox DEFAULTS TO PRIVATE. Publishing a layer onto everyone's map is
 * the more consequential of the two, so it is the deliberate click: an
 * accidental private layer costs one person a re-add, an accidental shared one
 * appears on every operator's map mid-incident.
 *
 * REFUSALS ARE SHOWN IN THE SERVER'S OWN WORDS. The backend takes care to say
 * "I could not read the catalogue" differently from "I read it and it
 * publishes no layers", and a form that renders one generic "failed to load"
 * discards that at the last step.
 */
import React, { useCallback, useId, useState, type JSX } from 'react';
import {
  fetchWmsCapabilities,
  createAdhocLayer,
  type WmsCatalogueLayer,
} from '../../../services/api.js';
import { addPrivateLayer, type AdhocLayerDefinition } from '../adhoc/privateAdhocLayers.js';

/**
 * Inline, like the rest of LayerPanel — it ships no stylesheet for these class
 * names, so a className alone renders unstyled. Found by looking at the running
 * panel, not by any test.
 */
const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '6px 8px',
  borderTop: '1px solid #f0f0f0',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  fontSize: '12px',
  color: '#555',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontSize: '12px',
  padding: '4px 6px',
  border: '1px solid #ddd',
  borderRadius: '4px',
};

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '6px',
  fontSize: '12px',
  color: '#333',
};

const hintStyle: React.CSSProperties = {
  margin: '2px 0 0',
  width: '100%',
  fontSize: '11px',
  color: '#777',
  lineHeight: 1.35,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
};

const buttonStyle: React.CSSProperties = {
  fontSize: '11px',
  padding: '3px 8px',
  border: '1px solid #ddd',
  borderRadius: '4px',
  background: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const formErrorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  color: '#b00020',
  lineHeight: 1.35,
};

export type AdhocLayerScope = 'private' | 'shared';

export interface AddAdhocLayerFormProps {
  /** Called once the layer is actually persisted, never before. */
  onAdded: (layer: AdhocLayerDefinition, scope: AdhocLayerScope) => void;
  onCancel?: () => void;
}

/** What we read, and from which url — so a changed url can invalidate it. */
interface Catalogue {
  readonly serviceUrl: string;
  readonly version: string;
  readonly layers: WmsCatalogueLayer[];
}

function messageFrom(error: unknown): string {
  // ApiError already carries the server's own text in `.message` (#339), for
  // both the nested and flat body shapes. Anything else is a real surprise and
  // says so rather than being dressed up as a WMS problem.
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong adding this layer.';
}

export function AddAdhocLayerForm({ onAdded, onCancel }: AddAdhocLayerFormProps): JSX.Element {
  const urlFieldId = useId();
  const layerFieldId = useId();
  const nameFieldId = useId();
  const privateFieldId = useId();

  const [serviceUrl, setServiceUrl] = useState('');
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [chosenLayerName, setChosenLayerName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A catalogue belongs to the url it was read from. Editing the url discards
   * it, so a layer chosen from one server can never be submitted against
   * another — that would store a layer name the new service does not publish,
   * and produce exactly the silent empty tile the chooser exists to prevent.
   */
  const handleUrlChange = useCallback((next: string) => {
    setServiceUrl(next);
    setCatalogue(null);
    setChosenLayerName('');
    setError(null);
  }, []);

  const handleRead = useCallback(async () => {
    const trimmed = serviceUrl.trim();
    if (trimmed === '') {
      setError('Enter the WMS service url first.');
      return;
    }

    setReading(true);
    setError(null);
    setCatalogue(null);
    setChosenLayerName('');

    try {
      const result = await fetchWmsCapabilities(trimmed);
      setCatalogue({ serviceUrl: trimmed, version: result.version, layers: result.layers });
    } catch (caught) {
      // Verbatim: whether this was "could not reach it" or "it publishes
      // nothing" is the part the user needs, and only the server knows which.
      setError(messageFrom(caught));
    } finally {
      setReading(false);
    }
  }, [serviceUrl]);

  const handleChooseLayer = useCallback(
    (layerName: string) => {
      setChosenLayerName(layerName);
      // Seed the display name from the server's title, which is the human
      // label it publishes. Editable, because a crew's name for a layer is
      // often not the publisher's.
      const chosen = catalogue?.layers.find((layer) => layer.name === layerName);
      setDisplayName((current) => (current === '' ? (chosen?.title ?? layerName) : current));
      setError(null);
    },
    [catalogue],
  );

  const canAdd = catalogue !== null && chosenLayerName !== '' && !saving;

  const handleAdd = useCallback(async () => {
    if (catalogue === null || chosenLayerName === '') return;

    const chosen = catalogue.layers.find((layer) => layer.name === chosenLayerName);
    const name = displayName.trim() === '' ? (chosen?.title ?? chosenLayerName) : displayName.trim();

    setSaving(true);
    setError(null);

    try {
      if (isPrivate) {
        const layer: AdhocLayerDefinition = {
          id: `adhoc-${crypto.randomUUID()}`,
          name,
          serviceUrl: catalogue.serviceUrl,
          layerName: chosenLayerName,
          wmsVersion: catalogue.version,
          // Kept with the layer so the scale warning survives a reload (#448);
          // the capabilities document is not fetched again on startup.
          ...(chosen?.minScaleDenominator !== undefined
            ? { minScaleDenominator: chosen.minScaleDenominator }
            : {}),
          ...(chosen?.maxScaleDenominator !== undefined
            ? { maxScaleDenominator: chosen.maxScaleDenominator }
            : {}),
        };

        if (!addPrivateLayer(layer)) {
          // No row exists anywhere else for a private layer, so a failed write
          // means the layer is gone. Saying "added" here would leave the user
          // believing in something that does not exist.
          setError(
            'This layer could not be saved — your browser is not storing site data. ' +
              'Untick Private to share it with the deployment instead.',
          );
          return;
        }

        onAdded(layer, 'private');
      } else {
        const created = await createAdhocLayer({
          name,
          serviceUrl: catalogue.serviceUrl,
          layerName: chosenLayerName,
          wmsVersion: catalogue.version,
        });

        onAdded(
          {
            id: created.layer.id,
            name: created.layer.name,
            serviceUrl: created.layer.serviceUrl,
            layerName: created.layer.layerName,
            wmsVersion: created.layer.wmsVersion,
            legendUrl: created.layer.legendUrl,
          },
          'shared',
        );
      }
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSaving(false);
    }
  }, [catalogue, chosenLayerName, displayName, isPrivate, onAdded]);

  return (
    <div className="adhoc-layer-form" style={formStyle}>
      <div className="adhoc-layer-form__row" style={fieldStyle}>
        <label htmlFor={urlFieldId}>WMS service url</label>
        <input
          id={urlFieldId}
          type="text"
          value={serviceUrl}
          placeholder="https://example.gov/geoserver/wms"
          style={inputStyle}
          onChange={(event) => handleUrlChange(event.target.value)}
        />
        <button type="button" style={buttonStyle} onClick={handleRead} disabled={reading}>
          {reading ? 'Reading…' : 'Read catalogue'}
        </button>
      </div>

      {catalogue !== null && (
        <>
          <div className="adhoc-layer-form__row" style={fieldStyle}>
            <label htmlFor={layerFieldId}>Layer</label>
            <select
              id={layerFieldId}
              value={chosenLayerName}
              style={inputStyle}
              onChange={(event) => handleChooseLayer(event.target.value)}
            >
              <option value="">Choose a layer…</option>
              {catalogue.layers.map((layer) => (
                <option key={layer.name} value={layer.name}>
                  {layer.title || layer.name}
                </option>
              ))}
            </select>
          </div>

          <div className="adhoc-layer-form__row" style={fieldStyle}>
            {/* The DISPLAY name — never the layer name. The layer name only
                ever comes from the chooser above. */}
            <label htmlFor={nameFieldId}>Display name</label>
            <input
              id={nameFieldId}
              type="text"
              value={displayName}
              style={inputStyle}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>

          <div className="adhoc-layer-form__row" style={checkboxRowStyle}>
            <input
              id={privateFieldId}
              type="checkbox"
              checked={isPrivate}
              onChange={(event) => setIsPrivate(event.target.checked)}
            />
            <label htmlFor={privateFieldId}>Private — only on this browser</label>
            <p className="adhoc-layer-form__hint" style={hintStyle}>
              {isPrivate
                ? 'Kept on this browser only. Nobody else will see it.'
                : 'Shared with everyone on this deployment. Only you can remove it.'}
            </p>
          </div>
        </>
      )}

      {error !== null && (
        <p role="alert" className="adhoc-layer-form__error" style={formErrorStyle}>
          {error}
        </p>
      )}

      <div className="adhoc-layer-form__actions" style={actionsStyle}>
        <button type="button" style={buttonStyle} onClick={handleAdd} disabled={!canAdd}>
          {saving ? 'Adding…' : 'Add layer'}
        </button>
        {onCancel && (
          <button type="button" style={buttonStyle} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
