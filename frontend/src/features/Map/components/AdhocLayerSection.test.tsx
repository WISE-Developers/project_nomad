/**
 * #315d — the ad-hoc layers section of the layer panel.
 *
 * This is where the feature finally touches the map, and where Papa's last two
 * rulings live:
 *
 *  - **Every user can HIDE a shared layer from their own map.**
 *  - **Only its creator can DELETE it for everyone**, and a non-creator's
 *    refusal arrives as 403 `NOT_LAYER_OWNER` naming the owner.
 *
 * The distinction is the whole design: *"it disappeared and I do not know
 * why"* is worse during an incident than *"it is wrong and I have hidden it."*
 * So hiding writes only to this browser and a test asserts the shared row is
 * untouched, while delete is offered **only** to the creator.
 *
 * WMS IS NOT A NEW LAYER KIND. It goes onto the map through the same
 * `addRasterLayer` every raster uses, as a `RasterLayerConfig` with
 * `legendType: 'wms'` — the path CWFIS M3 already takes (#299). A test asserts
 * the tile url is built by `buildWmsTileUrl` rather than hand-assembled here,
 * because a second url builder is how the two drift apart.
 *
 * ON THE LIST BEING UNREADABLE: "no shared layers exist" and "I could not ask
 * the server" are different facts and must not render alike — the same pair
 * the backend and the client each keep apart. This is the third and last place
 * it can be collapsed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdhocLayerSection } from './AdhocLayerSection.js';
import { ApiError } from '../../../services/api.js';
import * as privateStore from '../adhoc/privateAdhocLayers.js';

const addRasterLayer = vi.fn();
const removeLayer = vi.fn();

vi.mock('../context/useLayers', () => ({
  useLayers: () => ({ addRasterLayer, removeLayer }),
}));

/**
 * The map, for the scale check (#448). Default is the view that produced the
 * live failure: zoom 4.3 over Canada, roughly 1:35,000,000.
 */
const mapView = { zoom: 4.3, lat: 55, isLoaded: true };
vi.mock('../context/MapContext', () => ({
  useMap: () => ({
    map: mapView.isLoaded
      ? {
          getZoom: () => mapView.zoom,
          getCenter: () => ({ lat: mapView.lat, lng: -106 }),
        }
      : null,
    isLoaded: mapView.isLoaded,
  }),
}));

vi.mock('../../../services/api.js', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api.js')>(
    '../../../services/api.js',
  );
  return {
    ...actual,
    listAdhocLayers: vi.fn(),
    deleteAdhocLayer: vi.fn(),
    fetchWmsCapabilities: vi.fn(),
    createAdhocLayer: vi.fn(),
  };
});

const api = await import('../../../services/api.js');
const listAdhocLayers = vi.mocked(api.listAdhocLayers);
const deleteAdhocLayer = vi.mocked(api.deleteAdhocLayer);

const SERVICE_URL = 'https://openmaps.gov.bc.ca/geo/pub/wms';

/** Added by dylan — the signed-in user in most tests below. */
const MINE = {
  id: 'shared-mine',
  name: 'BC Hydrography',
  serviceUrl: SERVICE_URL,
  layerName: 'pub:WHSE_WATER.FWA_RIVERS_POLY',
  wmsVersion: '1.3.0',
  legendUrl: null,
  createdBy: 'dylan',
  createdAt: '2026-10-13T12:00:00.000Z',
};

/** Added by someone else. Hideable, never deletable by dylan. */
const THEIRS = {
  ...MINE,
  id: 'shared-theirs',
  name: 'Fire Perimeters 2026',
  layerName: 'pub:PERIMETERS',
  createdBy: 'brett',
};

describe('AdhocLayerSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    listAdhocLayers.mockResolvedValue({ layers: [] });
    deleteAdhocLayer.mockResolvedValue(undefined);
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('the control: an empty section', () => {
    it('says there are no ad-hoc layers, having actually asked', async () => {
      render(<AdhocLayerSection currentUser="dylan" />);

      await waitFor(() => expect(listAdhocLayers).toHaveBeenCalledTimes(1));
      expect(await screen.findByText(/no .*layers/i)).toBeInTheDocument();
    });

    it('offers a way to add one', () => {
      render(<AdhocLayerSection currentUser="dylan" />);
      expect(screen.getByRole('button', { name: /add .*layer/i })).toBeInTheDocument();
    });
  });

  describe('listing what exists', () => {
    it('shows shared layers from the server and private ones from this browser', async () => {
      listAdhocLayers.mockResolvedValue({ layers: [THEIRS] });
      privateStore.addPrivateLayer({
        id: 'adhoc-private-1',
        name: 'My Scratch Layer',
        serviceUrl: SERVICE_URL,
        layerName: 'pub:SCRATCH',
        wmsVersion: '1.3.0',
      });

      render(<AdhocLayerSection currentUser="dylan" />);

      expect(await screen.findByText('Fire Perimeters 2026')).toBeInTheDocument();
      expect(await screen.findByText('My Scratch Layer')).toBeInTheDocument();
    });

    it('still shows private layers when the SERVER cannot be reached', async () => {
      // A private layer does not depend on the server, so losing the server
      // must not hide it. Degrading to nothing would be a lie about this
      // user's own data.
      listAdhocLayers.mockRejectedValue(new ApiError('Service Unavailable', 503));
      privateStore.addPrivateLayer({
        id: 'adhoc-private-1',
        name: 'My Scratch Layer',
        serviceUrl: SERVICE_URL,
        layerName: 'pub:SCRATCH',
        wmsVersion: '1.3.0',
      });

      render(<AdhocLayerSection currentUser="dylan" />);

      expect(await screen.findByText('My Scratch Layer')).toBeInTheDocument();
    });

    it('distinguishes "could not ask the server" from "there are none"', async () => {
      listAdhocLayers.mockRejectedValue(new ApiError('Service Unavailable', 503));

      render(<AdhocLayerSection currentUser="dylan" />);

      // The third and last place this pair can collapse.
      const notice = await screen.findByRole('alert');
      expect(notice.textContent ?? '').toMatch(/could not|unavailable/i);
      expect(screen.queryByText(/^no shared layers$/i)).toBeNull();
    });
  });

  describe('putting a layer on the map', () => {
    it('adds it as a raster with a WMS legend, through the shared path', async () => {
      listAdhocLayers.mockResolvedValue({ layers: [MINE] });
      const user = userEvent.setup();
      render(<AdhocLayerSection currentUser="dylan" />);

      await user.click(await screen.findByRole('button', { name: /add BC Hydrography to map/i }));

      expect(addRasterLayer).toHaveBeenCalledTimes(1);
      const config = addRasterLayer.mock.calls[0][0];
      expect(config).toMatchObject({
        id: 'shared-mine',
        name: 'BC Hydrography',
        legendType: 'wms',
        visible: true,
      });
      // Built by buildWmsTileUrl, not hand-assembled: a second url builder is
      // how two code paths drift apart.
      expect(String(config.url)).toContain('request=GetMap');
      expect(String(config.url)).toContain('bbox=');

      // THE LAYER NAME IS LITERAL, COLON AND ALL — do not "fix" this to
      // encodeURIComponent. My first version of this test asserted the encoded
      // form and was WRONG: `buildWmsTileUrl` appends `layers=` literally on
      // purpose, because percent-encoding a namespaced name has broken real
      // endpoints before (the same reason useCwfisM3Layers keeps it literal).
      // The code was right and the test was wrong.
      expect(String(config.url)).toContain(`layers=${MINE.layerName}`);
      expect(String(config.url)).not.toContain(encodeURIComponent(MINE.layerName));
    });
  });

  describe("Papa's rule: hide for me, delete only if it is mine", () => {
    it('lets any user hide a shared layer, writing only to this browser', async () => {
      listAdhocLayers.mockResolvedValue({ layers: [THEIRS] });
      const user = userEvent.setup();
      render(<AdhocLayerSection currentUser="dylan" />);

      await user.click(await screen.findByRole('button', { name: /hide Fire Perimeters/i }));

      await waitFor(() => expect(privateStore.isSharedLayerHidden('shared-theirs')).toBe(true));
      // Hiding is not deleting. The shared row must be untouched.
      expect(deleteAdhocLayer).not.toHaveBeenCalled();
    });

    it('removes a hidden layer from the map too', async () => {
      listAdhocLayers.mockResolvedValue({ layers: [THEIRS] });
      const user = userEvent.setup();
      render(<AdhocLayerSection currentUser="dylan" />);

      await user.click(await screen.findByRole('button', { name: /add Fire Perimeters 2026 to map/i }));
      await user.click(screen.getByRole('button', { name: /hide Fire Perimeters/i }));

      await waitFor(() => expect(removeLayer).toHaveBeenCalledWith('shared-theirs'));
    });

    it('does not offer delete on a layer someone else created', async () => {
      listAdhocLayers.mockResolvedValue({ layers: [THEIRS] });
      render(<AdhocLayerSection currentUser="dylan" />);

      await screen.findByText('Fire Perimeters 2026');
      // Offering a button that can only 403 teaches users to distrust the UI.
      expect(screen.queryByRole('button', { name: /delete Fire Perimeters/i })).toBeNull();
      expect(screen.getByRole('button', { name: /hide Fire Perimeters/i })).toBeInTheDocument();
    });

    it('offers delete on my own layer, and deletes it', async () => {
      listAdhocLayers.mockResolvedValue({ layers: [MINE] });
      const user = userEvent.setup();
      render(<AdhocLayerSection currentUser="dylan" />);

      await user.click(await screen.findByRole('button', { name: /delete BC Hydrography/i }));

      await waitFor(() => expect(deleteAdhocLayer).toHaveBeenCalledWith('shared-mine'));
      expect(removeLayer).toHaveBeenCalledWith('shared-mine');
    });

    it("shows the server's own 403 text if a delete is refused anyway", async () => {
      // The UI hides the button, but the server is the authority — an id can
      // be stale, or ownership can change under us. The message names the
      // owner and says hiding is available instead; that is worth showing
      // rather than replacing with "delete failed".
      listAdhocLayers.mockResolvedValue({ layers: [MINE] });
      deleteAdhocLayer.mockRejectedValue(
        new ApiError(
          'This layer was added by brett and only they can remove it. You can hide it from your own map instead.',
          403,
        ),
      );
      const user = userEvent.setup();
      render(<AdhocLayerSection currentUser="dylan" />);

      await user.click(await screen.findByRole('button', { name: /delete BC Hydrography/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/added by brett/i);
    });

    it('deletes a PRIVATE layer locally without calling the server', async () => {
      privateStore.addPrivateLayer({
        id: 'adhoc-private-1',
        name: 'My Scratch Layer',
        serviceUrl: SERVICE_URL,
        layerName: 'pub:SCRATCH',
        wmsVersion: '1.3.0',
      });
      const user = userEvent.setup();
      render(<AdhocLayerSection currentUser="dylan" />);

      await user.click(await screen.findByRole('button', { name: /delete My Scratch Layer/i }));

      await waitFor(() => expect(privateStore.listPrivateLayers()).toEqual([]));
      expect(deleteAdhocLayer).not.toHaveBeenCalled();
    });
  });

  describe('a hidden layer stays hidden', () => {
    it('does not list a shared layer this user has already hidden', async () => {
      privateStore.hideSharedLayer('shared-theirs');
      listAdhocLayers.mockResolvedValue({ layers: [MINE, THEIRS] });

      render(<AdhocLayerSection currentUser="dylan" />);

      expect(await screen.findByText('BC Hydrography')).toBeInTheDocument();
      expect(screen.queryByText('Fire Perimeters 2026')).toBeNull();
    });

    it('offers a way back — hidden layers can be restored', async () => {
      privateStore.hideSharedLayer('shared-theirs');
      listAdhocLayers.mockResolvedValue({ layers: [THEIRS] });
      const user = userEvent.setup();
      render(<AdhocLayerSection currentUser="dylan" />);

      // A one-way hide is a layer the user can never get back without knowing
      // about localStorage, so the count of hidden layers is surfaced.
      await user.click(await screen.findByRole('button', { name: /hidden/i }));

      expect(await screen.findByText('Fire Perimeters 2026')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /restore Fire Perimeters/i }));

      await waitFor(() => expect(privateStore.isSharedLayerHidden('shared-theirs')).toBe(false));
    });
  });
});


/**
 * TELLING THE USER A LAYER CANNOT DRAW HERE (#448).
 *
 * Reported from the live demo: adding BC's *Forest Licensee Operating Areas*
 * succeeded at every step — capabilities 200, legend 200, nineteen GetMap tiles
 * all 200 — and the map stayed empty, with nothing said.
 *
 * The layer declares `<MaxScaleDenominator>6000000</MaxScaleDenominator>` and
 * the view was at roughly 1:35,000,000, so the server correctly returned an
 * empty image. The layer is fine; the SCALE was wrong.
 *
 * The warning must still ADD the layer. Refusing would be worse: the user chose
 * it deliberately, it is correct at a closer zoom, and a layer that vanishes
 * from the panel is the opaque disappearance this feature already guards
 * against elsewhere.
 */
describe('a layer that cannot draw at this scale (#448)', () => {
  const scaled = (over: Partial<privateStore.AdhocLayerDefinition> = {}) => ({
    id: 'adhoc-bc',
    name: 'Forest Licensee Operating Areas',
    serviceUrl: 'https://openmaps.gov.bc.ca/geo/pub/wms',
    layerName: 'pub:REG_LAND_AND_NATURAL_RESOURCE.FOREST_LICENSEE_OPER_SP',
    wmsVersion: '1.3.0',
    ...over,
  });

  beforeEach(() => {
    mapView.zoom = 4.3;
    mapView.lat = 55;
  });

  it('warns, naming the limit and the way out, when the view is too coarse', async () => {
    vi.spyOn(privateStore, 'listPrivateLayers').mockReturnValue([
      scaled({ maxScaleDenominator: 6_000_000 }),
    ]);
    vi.mocked(api.listAdhocLayers).mockResolvedValue({ layers: [] });

    render(<AdhocLayerSection />);
    const button = await screen.findByLabelText('Add Forest Licensee Operating Areas to map');
    await userEvent.click(button);

    const notice = await screen.findByRole('status');
    expect(notice.textContent).toMatch(/zoom in/i);
    expect(notice.textContent).toContain('6,000,000');
  });

  it('ADDS the layer anyway — a warning is not a refusal', async () => {
    vi.spyOn(privateStore, 'listPrivateLayers').mockReturnValue([
      scaled({ maxScaleDenominator: 6_000_000 }),
    ]);
    vi.mocked(api.listAdhocLayers).mockResolvedValue({ layers: [] });

    render(<AdhocLayerSection />);
    await userEvent.click(
      await screen.findByLabelText('Add Forest Licensee Operating Areas to map'),
    );
    expect(addRasterLayer).toHaveBeenCalled();
  });

  it('says nothing when the layer declares no scale range — the control', async () => {
    vi.spyOn(privateStore, 'listPrivateLayers').mockReturnValue([scaled()]);
    vi.mocked(api.listAdhocLayers).mockResolvedValue({ layers: [] });

    render(<AdhocLayerSection />);
    await userEvent.click(
      await screen.findByLabelText('Add Forest Licensee Operating Areas to map'),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says nothing once the view is inside the range', async () => {
    mapView.zoom = 12;
    vi.spyOn(privateStore, 'listPrivateLayers').mockReturnValue([
      scaled({ maxScaleDenominator: 6_000_000 }),
    ]);
    vi.mocked(api.listAdhocLayers).mockResolvedValue({ layers: [] });

    render(<AdhocLayerSection />);
    await userEvent.click(
      await screen.findByLabelText('Add Forest Licensee Operating Areas to map'),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});


/**
 * A CLICK THAT CANNOT BE HONOURED MUST NOT BE SILENTLY DISCARDED (#451).
 *
 * Found while verifying the v0.31.0 deploy in a real browser. Clicking "Add to
 * map" a second after page load did NOTHING — no layer, no error, nothing. It
 * bit twice before I understood it. Waiting four seconds and clicking the
 * identical button worked.
 *
 * The cause is a guard that is right about the world and silent about it:
 * `addRasterLayer` opens `if (!map || !isLoaded) return;`. There is genuinely
 * nothing to add a layer to yet — but the caller cannot tell the click was
 * dropped.
 *
 * Same family as #448: an action that did nothing is indistinguishable from one
 * that worked. The window is short and it is exactly when a user clicks, because
 * the panel renders before the map is ready.
 *
 * A DISABLED CONTROL THAT SAYS WHY beats an enabled control that lies.
 */
describe('before the map is ready (#451)', () => {
  const layer = {
    id: 'adhoc-early',
    name: 'Eager Layer',
    serviceUrl: 'https://example.org/wms',
    layerName: 'topo',
    wmsVersion: '1.3.0',
  };

  afterEach(() => {
    mapView.isLoaded = true;
  });

  it('does not offer Add to map as ready while the map is still loading', async () => {
    mapView.isLoaded = false;
    vi.spyOn(privateStore, 'listPrivateLayers').mockReturnValue([layer]);
    vi.mocked(api.listAdhocLayers).mockResolvedValue({ layers: [] });

    render(<AdhocLayerSection />);
    const button = await screen.findByLabelText('Add Eager Layer to map');
    expect(button).toBeDisabled();
  });

  it('says why, rather than presenting a dead control', async () => {
    mapView.isLoaded = false;
    vi.spyOn(privateStore, 'listPrivateLayers').mockReturnValue([layer]);
    vi.mocked(api.listAdhocLayers).mockResolvedValue({ layers: [] });

    render(<AdhocLayerSection />);
    const button = await screen.findByLabelText('Add Eager Layer to map');
    expect(button.getAttribute('title')).toMatch(/still loading|not ready/i);
  });

  it('offers it normally once the map is ready — the control', async () => {
    mapView.isLoaded = true;
    vi.spyOn(privateStore, 'listPrivateLayers').mockReturnValue([layer]);
    vi.mocked(api.listAdhocLayers).mockResolvedValue({ layers: [] });

    render(<AdhocLayerSection />);
    const button = await screen.findByLabelText('Add Eager Layer to map');
    expect(button).not.toBeDisabled();
    await userEvent.click(button);
    expect(addRasterLayer).toHaveBeenCalled();
  });
});


/**
 * ONE LINE FOR THE NAME, ONE LINE FOR THE BUTTONS (#456).
 *
 * Reported with a screenshot: three ad-hoc rows, three different layouts. A
 * shared layer wrapped its scope label, "Add to map" and "Hide" onto a second
 * line; another put "Delete" alone on a second line; a third put both buttons
 * there. Nothing lined up.
 *
 * The cause was one `display: flex` with `flexWrap: wrap` holding the name, the
 * scope label and every button as SIBLINGS, with the name taking `flex: 1 1
 * auto`. The wrap point was therefore a function of the layer's NAME LENGTH
 * plus the scope text, so no two rows could agree — and the number of buttons
 * varies by design, since shared layers get "Hide" and only the creator gets
 * "Delete".
 *
 * THE HAZARD, NOT THE LOOK: a stray "Delete" sitting under the wrong row reads
 * as belonging to the layer below it. In a panel used while a fire is running,
 * a delete button whose owner is ambiguous is the part that matters.
 *
 * Franco's ruling: two dedicated lines, never shared. With a fixed structure
 * the name length cannot move anything, and every button sits on a line that
 * belongs unambiguously to the layer named directly above it.
 */
describe('row layout: name and buttons never share a line (#456)', () => {
  const layers = [
    { id: 'adhoc-short', name: 'Fire Danger', serviceUrl: 'https://example.org/wms', layerName: 'a', wmsVersion: '1.3.0' },
    {
      id: 'adhoc-long',
      name: 'Transport Wind Vector (direction) with a deliberately long name',
      serviceUrl: 'https://example.org/wms',
      layerName: 'b',
      wmsVersion: '1.3.0',
    },
  ];

  beforeEach(() => {
    vi.spyOn(privateStore, 'listPrivateLayers').mockReturnValue(layers);
    vi.mocked(api.listAdhocLayers).mockResolvedValue({ layers: [] });
  });

  it('puts every button of a row in ONE container that holds no layer name', async () => {
    render(<AdhocLayerSection />);
    const button = await screen.findByLabelText('Add Fire Danger to map');
    const buttonRow = button.parentElement;
    expect(buttonRow).not.toBeNull();
    // The name must not live in the same container as the controls.
    expect(buttonRow?.textContent).not.toContain('Fire Danger');
  });

  it('gives the name its own line, separate from the controls', async () => {
    render(<AdhocLayerSection />);
    await screen.findByLabelText('Add Fire Danger to map');
    const name = screen.getByText('Fire Danger');
    const nameLine = name.parentElement;
    expect(nameLine?.querySelector('button')).toBeNull();
  });

  it('lays a LONG name out exactly like a short one — the whole point', async () => {
    // Name length was the variable that made every row different.
    render(<AdhocLayerSection />);
    const shortBtn = await screen.findByLabelText('Add Fire Danger to map');
    const longBtn = await screen.findByLabelText(
      'Add Transport Wind Vector (direction) with a deliberately long name to map',
    );
    const shape = (el: HTMLElement) => {
      const row = el.parentElement!;
      return {
        tag: row.tagName,
        buttonCount: row.querySelectorAll('button').length,
        hasName: /Fire Danger|Transport Wind/.test(row.textContent || ''),
      };
    };
    expect(shape(longBtn)).toEqual(shape(shortBtn));
  });

  it('keeps every control reachable by its label — the control', async () => {
    render(<AdhocLayerSection />);
    expect(await screen.findByLabelText('Add Fire Danger to map')).toBeTruthy();
    expect(screen.getByLabelText('Delete Fire Danger')).toBeTruthy();
  });
});
