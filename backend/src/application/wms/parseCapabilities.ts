/**
 * Parse a WMS GetCapabilities document into a layer chooser (#315).
 *
 * Franco ruled that a catalogue we cannot read REFUSES the URL rather than
 * falling through to a hand-typed layer name. That puts the whole weight on
 * this module's error reporting: if it cannot say WHICH failure occurred, the
 * form can only say "that didn't work", and the user cannot tell whether to fix
 * the URL, wait, or give up.
 *
 * The distinction it exists to preserve:
 *
 *   ok: true,  layers: []   the server WAS read, and offers nothing requestable
 *   ok: false, reason       we could not read it
 *
 * Both are "no layers". They mean opposite things, and collapsing them tells a
 * user "this server has nothing" when the truth is "I could not look."
 */
import { XMLParser } from 'fast-xml-parser';

export interface WmsLayer {
  /** The requestable name, as the server publishes it. */
  readonly name: string;
  readonly title: string;
  readonly abstract?: string;
  /**
   * Scale range the server will actually draw this layer at (#448).
   *
   * ABSENT MEANS UNCONSTRAINED, and that is not the same as zero. A layer
   * outside its declared range renders an EMPTY IMAGE with a 200, which is
   * indistinguishable from a layer that worked — BC's Forest Licensee
   * Operating Areas did exactly that on the live demo, declaring
   * `<MaxScaleDenominator>6000000</MaxScaleDenominator>` while the view sat at
   * roughly 1:35,000,000.
   *
   * Both are inherited from parent layers unless the child redefines them,
   * which is how the WMS spec says to read them and how BC publishes most of
   * theirs.
   */
  readonly minScaleDenominator?: number;
  readonly maxScaleDenominator?: number;
}

export type CapabilitiesResult =
  | { ok: true; version: string; layers: WmsLayer[] }
  | { ok: false; reason: string };

/** Both root elements in the wild. 1.1.1 renamed it. */
const ROOT_130 = 'WMS_Capabilities';
const ROOT_111 = 'WMT_MS_Capabilities';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Namespace prefixes vary by server; strip them so `wms:Layer` and `Layer`
  // are the same node to us.
  removeNSPrefix: true,
  trimValues: true,
});

/**
 * Always an array, whether the parser gave us one node or many.
 *
 * Typed as `unknown[]` on the way out and narrowed by the caller: the XML
 * parser returns `unknown`, and pretending otherwise at this boundary is how a
 * malformed document becomes a runtime crash instead of a refusal.
 */
function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** A parsed XML node, or undefined when the value was not an object. */
function asNode(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  return undefined;
}

/**
 * Walks the nested Layer tree, collecting only those with a `Name`.
 *
 * WMS nests layers, and a parent WITHOUT a Name is a grouping heading rather
 * than something you can request. Listing it gives the user something to pick
 * that can never render — a GetMap for it returns an error or a blank tile,
 * which looks like a broken feature rather than an unselectable heading.
 */
/**
 * A scale denominator, or undefined when the server did not give us a usable
 * one.
 *
 * NaN IS REFUSED DELIBERATELY. A NaN threshold compares false against
 * everything, so a warning built on it would silently never fire — the defect
 * wearing the fix's clothes. Absent and unreadable are both "we do not know",
 * and neither may masquerade as a limit.
 */
function scaleDenominator(value: unknown): number | undefined {
  const raw = text(value);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Scale limits inherited down the layer tree, per the WMS spec. */
interface InheritedScale {
  readonly min?: number;
  readonly max?: number;
}

function collectLayers(
  node: Record<string, unknown>,
  into: WmsLayer[],
  inherited: InheritedScale = {},
): void {
  const name = text(node.Name);
  const title = text(node.Title);

  // A child's own value wins; otherwise it inherits. BC publishes most of its
  // limits on parent layers, so ignoring inheritance would read nearly every
  // child as unconstrained — never warning, which is this bug in reverse.
  const min = scaleDenominator(node.MinScaleDenominator) ?? inherited.min;
  const max = scaleDenominator(node.MaxScaleDenominator) ?? inherited.max;

  if (name) {
    into.push({
      name,
      title: title ?? name,
      ...(text(node.Abstract) ? { abstract: text(node.Abstract) as string } : {}),
      ...(min !== undefined ? { minScaleDenominator: min } : {}),
      ...(max !== undefined ? { maxScaleDenominator: max } : {}),
    });
  }

  for (const child of asArray(node.Layer)) {
    const childNode = asNode(child);
    if (childNode) collectLayers(childNode, into, { min, max });
  }
}

export function parseCapabilities(body: string): CapabilitiesResult {
  if (!body || body.trim() === '') {
    // Zero bytes is the purest form of the confusion this module guards
    // against: nothing came back, which is not the same as nothing being there.
    return { ok: false, reason: 'the server returned an empty response' };
  }

  // Cheap check before parsing. An endpoint that 302s to a login page, or a
  // proxy returning an error page with status 200, is well-formed markup with
  // no layers in it — exactly the shape that would otherwise parse to "empty"
  // and read as "this server has nothing".
  if (/^\s*(<!doctype\s+html|<html[\s>])/i.test(body)) {
    return {
      ok: false,
      reason:
        'the server returned an HTML page rather than a WMS capabilities document — ' +
        'the URL may point at a web page, or require a sign-in',
    };
  }

  let document: Record<string, unknown>;
  try {
    document = parser.parse(body) as Record<string, unknown>;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `the response could not be parsed as XML: ${detail}` };
  }

  if (!document || typeof document !== 'object') {
    return { ok: false, reason: 'the response could not be parsed as XML' };
  }

  // A ServiceExceptionReport is how a WMS server refuses. Parsing it as a
  // catalogue would convert an explicit, explained refusal into an empty list —
  // throwing away the only authoritative account of what went wrong.
  const exceptionReport = asNode(document.ServiceExceptionReport);
  if (exceptionReport) {
    const first = asArray(exceptionReport.ServiceException)[0];
    const message = text(first) ?? text(asNode(first)?.['#text']) ?? undefined;
    return {
      ok: false,
      reason: message
        ? `the server refused the request: ${message}`
        : 'the server returned a WMS exception report rather than a capabilities document',
    };
  }

  const root = asNode(document[ROOT_130]) ?? asNode(document[ROOT_111]);
  if (!root) {
    return {
      ok: false,
      reason:
        'the response is XML but not a WMS capabilities document — expected a ' +
        `<${ROOT_130}> or <${ROOT_111}> element`,
    };
  }

  // Read the version from the document rather than guessing it: 1.3.0 takes
  // `crs`, 1.1.1 takes `srs`, and getting it wrong produces a layer that either
  // fails or renders offset.
  const version = text(root['@_version']) ?? '1.3.0';

  const layers: WmsLayer[] = [];
  const capability = asNode(root.Capability);
  for (const node of asArray(capability?.Layer)) {
    const layerNode = asNode(node);
    if (layerNode) collectLayers(layerNode, layers);
  }

  // Deliberately ok:true. The server WAS read; it simply offers nothing
  // requestable. That is an answer, not a failure.
  return { ok: true, version, layers };
}
