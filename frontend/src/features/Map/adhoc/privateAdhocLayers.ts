/**
 * #315a — the per-user half of ad-hoc layers.
 *
 * Papa's ruling: a **private checkbox** decides storage. Private means the
 * layer never reaches the server, so this module is the whole persistence
 * story for it. There is no row elsewhere to fall back on, which is why a
 * failed write is reported rather than swallowed.
 *
 * Two kinds of state live here, and they belong together because both answer
 * the same question — *what does THIS user see?*
 *
 *   1. private layers — this user's own, never shared
 *   2. the ids of SHARED layers this user has hidden from their own map
 *
 * (2) is the counterpart to creator-only delete: everyone may hide a shared
 * layer for themselves, only its author removes it for everyone. Per-user
 * state about someone else's row is exactly what local storage is for, and
 * nothing in this module can touch a shared row.
 *
 * Reads are forgiving, writes are honest. A browser that blocks site data, a
 * private window, or a value corrupted by an older build must not take the
 * layer panel down — but `addPrivateLayer` returns `false` when the write did
 * not land, so the caller can say so. A success reported for a write that went
 * nowhere is the silent default this house refuses.
 */
import { getItem, setItem } from '../../../shared/utils/storage';

/** Matches the Map feature's existing `nomad-<kebab>` key convention. */
export const PRIVATE_LAYERS_KEY = 'nomad-adhoc-layers-private';
export const HIDDEN_SHARED_KEY = 'nomad-adhoc-layers-hidden';

/**
 * A WMS layer the user has added by hand.
 *
 * Deliberately the same shape the shared API returns, minus `createdBy` and
 * `createdAt` — a private layer has no author worth recording, because there
 * is only ever one reader.
 */
export interface AdhocLayerDefinition {
  readonly id: string;
  readonly name: string;
  readonly serviceUrl: string;
  readonly layerName: string;
  readonly wmsVersion: string;
  readonly legendUrl?: string | null;
  /**
   * Carried from the capabilities document so the warning survives a reload
   * (#448). Absent means the server declared no limit, not a limit of zero.
   */
  readonly minScaleDenominator?: number;
  readonly maxScaleDenominator?: number;
}

/**
 * Could this value actually draw a tile?
 *
 * A row missing its `serviceUrl` or `layerName` renders in the panel and then
 * draws nothing forever — the silent empty tile Papa's chooser rule exists to
 * prevent. Shape drift from an older build is discarded on read rather than
 * displayed.
 */
function isUsableLayer(value: unknown): value is AdhocLayerDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id !== '' &&
    typeof candidate.name === 'string' &&
    typeof candidate.serviceUrl === 'string' &&
    candidate.serviceUrl !== '' &&
    typeof candidate.layerName === 'string' &&
    candidate.layerName !== '' &&
    typeof candidate.wmsVersion === 'string'
  );
}

/**
 * `shared/utils/storage` already returns null rather than throwing, but a
 * browser can throw from the accessor itself (thumbnailing, blocked site
 * data), which happens before that wrapper's own try/catch in some engines.
 * One more guard here keeps the panel alive.
 */
function readList<T>(key: string, accept: (value: unknown) => value is T): T[] {
  let raw: unknown;
  try {
    raw = getItem<unknown>(key);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(accept);
}

function writeList<T>(key: string, value: T[]): boolean {
  try {
    return setItem(key, value);
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

export function listPrivateLayers(): AdhocLayerDefinition[] {
  return readList(PRIVATE_LAYERS_KEY, isUsableLayer);
}

/**
 * Add or replace a private layer.
 *
 * @returns whether it actually persisted. `false` means the user's layer is
 * NOT saved and they need to be told.
 */
export function addPrivateLayer(layer: AdhocLayerDefinition): boolean {
  const existing = listPrivateLayers();
  const index = existing.findIndex((candidate) => candidate.id === layer.id);

  // Replace in place rather than appending, so re-adding under the same id
  // does not produce two rows the user cannot tell apart.
  const next =
    index >= 0
      ? [...existing.slice(0, index), layer, ...existing.slice(index + 1)]
      : [...existing, layer];

  return writeList(PRIVATE_LAYERS_KEY, next);
}

/** @returns whether a layer was actually removed — `false` if there was none. */
export function removePrivateLayer(id: string): boolean {
  const existing = listPrivateLayers();
  const next = existing.filter((layer) => layer.id !== id);
  if (next.length === existing.length) return false;
  return writeList(PRIVATE_LAYERS_KEY, next);
}

/**
 * Record a legend graphic URL the user supplied by hand (#449).
 *
 * A WMS server is not obliged to serve a legend, and some that do cannot serve
 * one for every layer — the derived `GetLegendGraphic` URL simply 404s or
 * returns something that is not an image. The layer itself is fine; only its
 * legend is missing, and the user may well know where the real one lives.
 *
 * @returns whether it persisted. `false` means either no such layer or the
 * browser is not storing site data, and the caller must say so rather than
 * implying the URL was kept.
 */
export function setPrivateLayerLegendUrl(id: string, legendUrl: string): boolean {
  const existing = listPrivateLayers();
  const index = existing.findIndex((layer) => layer.id === id);
  if (index < 0) return false;

  const updated: AdhocLayerDefinition = { ...existing[index], legendUrl };
  const next = [...existing.slice(0, index), updated, ...existing.slice(index + 1)];
  return writeList(PRIVATE_LAYERS_KEY, next);
}

/**
 * Layers whose legend prompt the user has waved away (#449).
 *
 * A DISMISSAL MUST PERSIST. Asking again on every reload is its own defect:
 * the user already answered, and a prompt that will not take no for an answer
 * is one people learn to click past without reading — which costs more than
 * the missing legend did.
 */
export const LEGEND_PROMPT_DISMISSED_KEY = 'nomad-adhoc-legend-prompt-dismissed';

export function listDismissedLegendPrompts(): string[] {
  return readList(LEGEND_PROMPT_DISMISSED_KEY, isNonEmptyString);
}

export function isLegendPromptDismissed(id: string): boolean {
  return listDismissedLegendPrompts().includes(id);
}

export function dismissLegendPrompt(id: string): boolean {
  const existing = listDismissedLegendPrompts();
  if (existing.includes(id)) return true;
  return writeList(LEGEND_PROMPT_DISMISSED_KEY, [...existing, id]);
}

export function listHiddenSharedIds(): string[] {
  return readList(HIDDEN_SHARED_KEY, isNonEmptyString);
}

export function isSharedLayerHidden(id: string): boolean {
  return listHiddenSharedIds().includes(id);
}

/** Hide a SHARED layer from this user's map only. The shared row is untouched. */
export function hideSharedLayer(id: string): boolean {
  const hidden = listHiddenSharedIds();
  if (hidden.includes(id)) return true;
  return writeList(HIDDEN_SHARED_KEY, [...hidden, id]);
}

export function unhideSharedLayer(id: string): boolean {
  const hidden = listHiddenSharedIds();
  const next = hidden.filter((candidate) => candidate !== id);
  if (next.length === hidden.length) return true;
  return writeList(HIDDEN_SHARED_KEY, next);
}
