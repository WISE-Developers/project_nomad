/**
 * The CRS a job file already states, so the operator is not asked for it
 * (refs #294).
 *
 * extractIgnitions was written on the premise that "an .fgmj names a
 * projection but does not carry one". That is true of some files and false of
 * most. Across 66 real .fgmj files:
 *
 *   5   carry the projection INLINE, as grid.projection.wkt / .contents
 *   55  name a .prj that is still sitting beside the job, usually
 *       "Inputs/dataset.prj"
 *   6   name one that is genuinely missing
 *
 * So 60 of 66 state their own CRS, and asking the operator for those is asking
 * for something the file already said. Franco hit this on SS008-25, whose
 * grid.projection carries a full Canada_Albers_Equal_Area_Conic WKT beside the
 * `filename: "dataset"` the importer was reading instead.
 *
 * What does NOT change is the refusal to GUESS. A wrong CRS completes, looks
 * entirely plausible, and puts the fire hundreds of kilometres from where it
 * was. Reading a CRS the file states is not guessing; inventing one when it
 * says nothing still is, and this returns undefined for that case so the
 * blocker stands.
 *
 * The sidecar lookup is why the import panel recommends uploading the job as a
 * ZIP: the Inputs/ folder travels with it, so the .prj is where the file says.
 */

import fs from 'fs';
import path from 'path';
import { textOf } from './fgmjValues.js';
import type { FgmjProject } from './loadFgmjProject.js';

interface ProjectionBlock {
  wkt?: unknown;
  contents?: unknown;
  filename?: unknown;
}

/**
 * Unwraps the schema's StringValue nesting, then trims.
 *
 * Reading these as plain strings is why this looked like a file that carried
 * no projection: decoded, `"wkt": "PROJCS[...]"` arrives as
 * `{ value: "PROJCS[...]" }`, and a plain-string read returns undefined —
 * indistinguishable from absent.
 */
const asText = (value: unknown): string | undefined => {
  const text = textOf(value);
  return text && text.trim().length > 0 ? text.trim() : undefined;
};

/** A .prj holds WKT and nothing else. Anything that is not WKT is not a CRS. */
const looksLikeWkt = (text: string): boolean => /^\s*(PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[/i.test(text);

export interface FileProjection {
  wkt: string;
  /** Where it came from, so a resolved CRS is never mistaken for a guess. */
  source: 'inline' | 'sidecar';
  /** The sidecar path actually read, for the audit trail. */
  path?: string;
}

/**
 * Returns the projection the file states, or undefined when it states none.
 *
 * Deliberately NOT falling back to a default, a nearby .prj with a different
 * name, or the units label. Each of those would be a guess wearing a fact's
 * clothing.
 */
export function projectionFromFile(project: FgmjProject): FileProjection | undefined {
  const grid = (project.raw as { grid?: { projection?: ProjectionBlock } }).grid;
  const projection = grid?.projection;
  if (!projection) return undefined;

  // Inline first: when the job carries the definition itself there is nothing
  // to resolve and nothing that can have gone missing.
  const inline = asText(projection.wkt) ?? asText(projection.contents);
  if (inline && looksLikeWkt(inline)) {
    return { wkt: inline, source: 'inline' };
  }

  // Then the .prj the file names, relative to the job — the same way its
  // weather path is resolved.
  const filename = asText(projection.filename);
  if (!filename) return undefined;

  // "dataset" with no extension is a dataset NAME, not a file beside the job.
  // Older files carry "Inputs/dataset.prj", which is a path.
  if (!/\.prj$/i.test(filename)) return undefined;

  const resolved = path.resolve(project.baseDir, filename);
  if (!fs.existsSync(resolved)) return undefined;

  const contents = asText(fs.readFileSync(resolved, 'utf-8'));
  if (!contents || !looksLikeWkt(contents)) return undefined;

  return { wkt: contents, source: 'sidecar', path: resolved };
}
