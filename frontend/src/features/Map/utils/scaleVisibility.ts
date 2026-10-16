/**
 * Whether a WMS layer can draw at the scale the user is currently looking at
 * (#448).
 *
 * A server asked for a layer outside its declared scale range replies with an
 * EMPTY IMAGE and a 200. Nothing fails and nothing warns, so a layer that
 * cannot draw is indistinguishable from one that worked — the map is simply
 * blank. On the live CIFFC demo, BC's *Forest Licensee Operating Areas*
 * produced capabilities 200, legend 200, nineteen GetMap tiles all 200, and an
 * empty map, because it declares a maximum of 1:6,000,000 and the view was at
 * roughly 1:35,000,000.
 *
 * Sampling returned tiles for transparent pixels would also detect that
 * something was wrong. Only the DECLARED RANGE can say why it is wrong and what
 * to do about it — and it can say so before a single tile is requested.
 */

/**
 * The OGC standard pixel: 0.28 mm. A scale denominator is only meaningful
 * against an assumed physical pixel size, and this is the one WMS 1.3.0 names,
 * which is the same assumption the servers publishing these limits used.
 */
const OGC_PIXEL_METRES = 0.00028;

/** Web Mercator ground resolution at zoom 0, metres per pixel at the equator. */
const EQUATOR_METRES_PER_PIXEL = 156_543.033_928;

/**
 * The scale denominator of a Web Mercator view — the N in "1:N".
 *
 * Latitude matters: Web Mercator stretches ground distance towards the poles,
 * so the same zoom level is a FINER scale further north. Canada sits far enough
 * north that ignoring it would misreport the scale by roughly a factor of two.
 */
export function scaleDenominatorFor(zoom: number, latitude: number): number {
  const metresPerPixel =
    (EQUATOR_METRES_PER_PIXEL * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
  return metresPerPixel / OGC_PIXEL_METRES;
}

export interface ScaleRange {
  /** Finest scale the layer draws at. Absent means unconstrained. */
  readonly minScaleDenominator?: number;
  /** Coarsest scale the layer draws at. Absent means unconstrained. */
  readonly maxScaleDenominator?: number;
}

export interface ScaleVisibility {
  readonly visible: boolean;
  /** Which way the user must move to bring the layer into range. */
  readonly direction?: 'zoom-in' | 'zoom-out';
  /** Plain-language explanation, naming both numbers. */
  readonly reason?: string;
}

const VISIBLE: ScaleVisibility = { visible: true };

/** `1234567` → `1,234,567`, so a scale reads as a scale. */
function withSeparators(value: number): string {
  return Math.round(value).toLocaleString('en-CA');
}

/**
 * Assess a view against a layer's declared range.
 *
 * ABSENT IS NOT A LIMIT. A layer declaring no range is unconstrained and is
 * always reported visible; so is a view whose scale could not be computed. Both
 * are "we do not know", and neither may be reported as a problem — a warning
 * that fires on working layers is one people learn to ignore, which would cost
 * more than the blank map it replaced.
 *
 * The boundary itself counts as visible: a layer exactly at its declared limit
 * draws.
 */
export function assessScaleVisibility(
  viewScaleDenominator: number,
  range: ScaleRange,
): ScaleVisibility {
  if (!Number.isFinite(viewScaleDenominator)) return VISIBLE;

  const { minScaleDenominator: min, maxScaleDenominator: max } = range;

  // Zoomed too far OUT: the view is coarser than the layer's coarsest scale.
  if (max !== undefined && Number.isFinite(max) && viewScaleDenominator > max) {
    return {
      visible: false,
      direction: 'zoom-in',
      reason:
        `This layer is only drawn at 1:${withSeparators(max)} or closer. ` +
        `The map is currently at about 1:${withSeparators(viewScaleDenominator)}, ` +
        'so the server returns an empty image — zoom in to see it.',
    };
  }

  // Zoomed too far IN: an overview layer the server drops at close range.
  if (min !== undefined && Number.isFinite(min) && viewScaleDenominator < min) {
    return {
      visible: false,
      direction: 'zoom-out',
      reason:
        `This layer is only drawn at 1:${withSeparators(min)} or wider. ` +
        `The map is currently at about 1:${withSeparators(viewScaleDenominator)}, ` +
        'so the server returns an empty image — zoom out to see it.',
    };
  }

  return VISIBLE;
}
