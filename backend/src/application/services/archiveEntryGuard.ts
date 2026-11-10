/**
 * Validate the entries of an uploaded archive before anything is written (#517).
 *
 * `POST /import` used each entry's final path segment verbatim — as a filename on disk and
 * as the stored `metadata.filePath` that later reaches the FireSTARR post-processing. This
 * module is the single place those names are judged, so the rule does not drift between
 * callers the way the containment check already had: `importFgmjUpload.extractSafely()`
 * resolved each target against its root, while `import.ts` relied on splitting the name and
 * taking the last segment. Two rules for one job is one rule more than can be trusted.
 *
 * It deliberately does NOT inflate anything. Every decision is made from the archive's
 * declared headers, so an archive is refused before `entry.getData()` is ever called.
 */

import path from 'path';
import { ValidationError } from '../../domain/errors/index.js';

/**
 * The shape this guard reads. Narrower than adm-zip's entry on purpose — it means the rules
 * can be tested without constructing real archives, and it documents exactly what is
 * consulted.
 */
export interface ArchiveEntryLike {
  readonly entryName: string;
  readonly isDirectory: boolean;
  readonly header: { readonly size: number };
}

/**
 * Permitted final-segment names: starts with a letter or digit, then letters, digits, dot,
 * underscore or hyphen, to 200 characters.
 *
 * Derived from what Nomad itself exports rather than guessed — `model.json`,
 * `metadata.txt`, `arrival_time.tif`, `perimeter-day1-2026.geojson`,
 * `firestarr_10N_50651_wx.csv`, `dem_18_5.tif` all satisfy it. Requiring the FIRST
 * character to be alphanumeric is what excludes a leading `-`, which a later command-line
 * tool reads as an option rather than a path.
 */
export const SAFE_ENTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/**
 * Entry-count ceiling. A real Nomad export of one fire was 111 files, so this is more than
 * two orders of magnitude above anything observed; it exists to bound the per-entry work,
 * not to second-guess a legitimate export. Raise it if a genuine export is ever refused.
 */
export const MAX_ENTRIES = 25_000;

/**
 * Total declared uncompressed size ceiling.
 *
 * Derived from the upload limit rather than picked: `import.ts` caps the upload at 500 MB
 * compressed, so 4 GiB is roughly an 8:1 expansion ceiling — comfortably above the ratios
 * GeoTIFF outputs achieve, and bounded so a small upload cannot ask for unbounded disk.
 *
 * Note what this does and does not bound. Peak MEMORY is set by the largest single entry,
 * because the route inflates one entry at a time; this ceiling bounds total DISK written.
 */
export const MAX_TOTAL_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024;

/**
 * Whether `name` placed in `dir` stays inside `dir`.
 *
 * The rule `extractSafely()` already applied, lifted here so both callers share one
 * implementation. adm-zip normalises `../` when adding files but NOT when reading them, so
 * a crafted archive arrives with the traversal intact.
 */
export function resolvesInside(dir: string, name: string): boolean {
  const root = path.resolve(dir) + path.sep;
  return path.resolve(dir, name).startsWith(root);
}

/** The final `/`-separated segment, which is what the import writes to disk. */
export function finalSegment(entryName: string): string {
  const parts = entryName.split('/');
  return parts[parts.length - 1] ?? '';
}

/**
 * Throw unless every entry is safe to write into `dir`.
 *
 * Refuses the WHOLE archive on the first failure, as `extractSafely()` does, rather than
 * skipping the offending entry. A partial import is the worse outcome: it leaves a model
 * whose results are quietly incomplete, and nothing downstream can tell that from a model
 * that simply produced fewer outputs.
 */
export function assertArchiveEntriesSafe(
  entries: readonly ArchiveEntryLike[],
  dir: string,
): void {
  if (entries.length > MAX_ENTRIES) {
    throw new ValidationError(
      `Archive declares ${entries.length} entries, above the limit of ${MAX_ENTRIES}. ` +
        'Refusing the whole archive.',
    );
  }

  let totalBytes = 0;
  const seen = new Map<string, string>();

  for (const entry of entries) {
    // Directory entries legitimately end in '/', which the name rule would refuse. They
    // are also not written by the import, which flattens to the final segment.
    if (entry.isDirectory) continue;

    const name = finalSegment(entry.entryName);

    if (!SAFE_ENTRY_NAME.test(name)) {
      throw new ValidationError(
        `Archive entry name "${entry.entryName}" is not permitted. Entry names may ` +
          'contain letters, digits, dot, underscore and hyphen, and must begin with a ' +
          'letter or digit. Refusing the whole archive.',
      );
    }

    if (!resolvesInside(dir, name)) {
      throw new ValidationError(
        `Archive entry "${entry.entryName}" resolves outside the import directory. ` +
          'Refusing the whole archive rather than skipping the entry.',
      );
    }

    const previous = seen.get(name);
    if (previous !== undefined) {
      throw new ValidationError(
        `Archive has a duplicate final name: "${previous}" and "${entry.entryName}" both ` +
          `end in "${name}". The import writes by final name, so one would silently ` +
          'overwrite the other. Refusing the whole archive.',
      );
    }
    seen.set(name, entry.entryName);

    // Declared size, read from the header. Nothing is inflated to reach this decision.
    totalBytes += entry.header.size;
    if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new ValidationError(
        `Archive declares an uncompressed size above the limit of ` +
          `${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes. Refusing the whole archive.`,
      );
    }
  }
}
