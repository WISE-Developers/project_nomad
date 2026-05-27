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

// __dirname at runtime: dist/services/splash. Default file lives at
// backend/data/default-splash.md relative to the backend root.
// From dist/services/splash -> ../../../data/default-splash.md (backend/data)
// From src/services/splash -> ../../../data/default-splash.md (backend/data)
export const DEFAULT_SPLASH_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'data',
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
