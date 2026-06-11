/**
 * sldPalette — parse the vendored FireSTARR probability SLD into a typed,
 * order-preserving palette.
 *
 * Issue #283 / #190 / #270 — Unit 1. The probability legend DERIVES from the
 * engine's authoritative SLD (gis/symbology/probability_processing.sld, pinned
 * @93fc5aa), never an invented constant. Fail-fast: a missing or malformed SLD
 * throws — there is no silent default ramp.
 *
 * The vendored ColorMap is `type="intervals"` (discrete classes, no
 * interpolation): 2 transparent sentinels (opacity 0) + 10 visible probability
 * ramp classes (quantities are 0-1 FRACTIONS, blue #00b1f2 -> red #e6151f) + 3
 * WMS-import status rows (Unprocessed, Processing, Existing).
 */

/** A single `<ColorMapEntry>` row, normalized. */
export interface SldColorMapEntry {
  /** Upper bound of the class, as a 0-1 probability fraction (not percent). */
  quantity: number;
  /** Hex colour, e.g. "#00b1f2". */
  color: string;
  /** 0..1; defaults to 1 when the attribute is absent. 0 == transparent sentinel. */
  opacity: number;
  /** Human-readable class label, e.g. "0.0 - 0.1". */
  label: string;
}

/** The parsed probability palette, with the SLD's roles separated out. */
export interface ProbabilityPalette {
  /** ColorMap `type` attribute — expected "intervals" (discrete). */
  type: string;
  /** Every ColorMapEntry, in document order. */
  entries: SldColorMapEntry[];
  /** The visible probability ramp (opacity > 0, quantity <= 1), low -> high. */
  rampClasses: SldColorMapEntry[];
  /** Transparent sentinels (opacity 0) — excluded from the visible legend. */
  sentinels: SldColorMapEntry[];
  /** WMS-import status rows (quantity > 1): Unprocessed, Processing, Existing. */
  importStatus: SldColorMapEntry[];
  /** The "Existing" already-burned overlay colour. */
  existing: SldColorMapEntry;
}

/** Quantities at or below this are part of the 0-1 probability ramp. */
const RAMP_MAX_QUANTITY = 1.0000001;

function elementsByLocalName(root: Document | Element, local: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter(
    (el) => el.localName === local,
  );
}

/**
 * Parse an SLD XML string into a {@link ProbabilityPalette}.
 * @throws if the XML is malformed, has no ColorMap, or an entry lacks a colour.
 */
export function parseProbabilitySld(xml: string): ProbabilityPalette {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('parseProbabilitySld: malformed SLD XML (parser error).');
  }

  const colorMap = elementsByLocalName(doc, 'ColorMap')[0];
  if (!colorMap) {
    throw new Error('parseProbabilitySld: no <ColorMap> element found in SLD.');
  }

  const type = colorMap.getAttribute('type') ?? '';

  const entries: SldColorMapEntry[] = elementsByLocalName(colorMap, 'ColorMapEntry').map(
    (el) => {
      const color = el.getAttribute('color');
      if (!color) {
        throw new Error(
          `parseProbabilitySld: ColorMapEntry missing required "color" attribute (label="${el.getAttribute('label') ?? ''}").`,
        );
      }
      const opacityAttr = el.getAttribute('opacity');
      return {
        quantity: Number(el.getAttribute('quantity')),
        color,
        opacity: opacityAttr === null ? 1 : Number(opacityAttr),
        label: el.getAttribute('label') ?? '',
      };
    },
  );

  const sentinels = entries.filter((e) => e.opacity === 0);
  const rampClasses = entries.filter(
    (e) => e.opacity !== 0 && e.quantity <= RAMP_MAX_QUANTITY,
  );
  const importStatus = entries.filter((e) => e.quantity > RAMP_MAX_QUANTITY);
  const existing = importStatus.find((e) => e.label === 'Existing');
  if (!existing) {
    throw new Error('parseProbabilitySld: missing the "Existing" status row.');
  }

  return { type, entries, rampClasses, sentinels, importStatus, existing };
}
