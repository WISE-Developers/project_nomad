/**
 * Application version.
 *
 * The version is injected as NOMAD_VERSION at image build time from
 * frontend/package.json, which is the release source of truth (see
 * .github/workflows/dev-release.yml, which reads
 * `require('./frontend/package.json').version`). The root and backend
 * package.json files sit at 0.5.0 and are not bumped by any release.
 *
 * DO NOT use process.env.npm_package_version. It is only populated when a
 * process is launched via npm, and every container runs `node dist/index.js`
 * directly - so it is always unset in a real deployment. Both previous call
 * sites fell back to a literal:
 *
 *   index.ts:      process.env.npm_package_version || '0.0.0'
 *   health.ts:     process.env.npm_package_version || '1.0.0'
 *
 * The result was /api/v1/info reporting "1.0.0" from a production box running
 * v0.12.1, for a long time, to everyone who asked. It never failed - it
 * answered, with a fabricated number. That is exactly why there is no fallback
 * here.
 */

import { readFileSync } from 'node:fs';

/** Semantic version, optionally with a pre-release suffix such as -dev.2 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** Written by the Dockerfile at build time from frontend/package.json. */
export const VERSION_FILE = process.env.NOMAD_VERSION_FILE ?? '/app/VERSION';

/** Reads the baked version file, or undefined when it is not present. */
function readVersionFile(): string | undefined {
  try {
    return readFileSync(VERSION_FILE, 'utf8');
  } catch {
    // Absent outside a built image - e.g. local dev and tests.
    return undefined;
  }
}

/**
 * Resolves the running application version.
 *
 * @returns the version string, e.g. '0.12.1' or '0.12.1-dev.2'
 * @throws Error if unset, empty, or not a version number. A service that
 *         cannot say what it is should not serve.
 */
export function resolveAppVersion(): string {
  // Two real sources, in order: an explicit env var, or the file baked into the
  // image at build time. Neither is a placeholder - if both are absent we throw
  // rather than invent a number.
  const raw = (process.env.NOMAD_VERSION ?? readVersionFile())?.trim();

  if (!raw) {
    throw new Error(
      'Cannot determine the application version. NOMAD_VERSION is not set and ' +
        `no version file was found at ${VERSION_FILE}. The version is baked at ` +
        'image build time from frontend/package.json. Refusing to report a ' +
        'placeholder version.'
    );
  }

  if (!VERSION_PATTERN.test(raw)) {
    throw new Error(
      `Invalid NOMAD_VERSION: "${raw}" is not a version number (expected e.g. 0.12.1 ` +
        'or 0.12.1-dev.2).'
    );
  }

  return raw;
}
