/**
 * Splash file path resolution (refs #275).
 *
 * Precedence:
 *   1. NOMAD_SPLASH_PATH (absolute file path)
 *   2. NOMAD_DATA_PATH/splash.md
 *   3. backend/data/default-splash.md (bundled default)
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// __dirname at runtime resolves to either src/services/splash (vitest) or
// dist/services/splash (built). In both cases the asset is colocated with
// this module under ./assets/default-splash.md so the same relative path
// works in test and production.
export const DEFAULT_SPLASH_PATH = path.resolve(
  __dirname,
  'assets',
  'default-splash.md',
);

export interface SplashEnv {
  NOMAD_SPLASH_PATH?: string;
  NOMAD_DATA_PATH?: string;
}

export function resolveSplashPath(env: SplashEnv): string {
  if (env.NOMAD_SPLASH_PATH) return env.NOMAD_SPLASH_PATH;
  if (env.NOMAD_DATA_PATH) return path.join(env.NOMAD_DATA_PATH, 'splash.md');
  return DEFAULT_SPLASH_PATH;
}
