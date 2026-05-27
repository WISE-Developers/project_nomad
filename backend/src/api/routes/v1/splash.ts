/**
 * GET /api/v1/splash — configurable splash screen content (#275).
 *
 * Always returns 200. When disabled or BOTH the configured path AND the bundled
 * default are unreadable/malformed, returns { enabled: false } so the frontend
 * can branch without handling errors.
 *
 * If the configured path is unreadable or malformed, falls back to the
 * bundled default. Operators can rely on ENABLED=true always showing something.
 *
 * The file is read fresh on each request — content is tiny and operators
 * should be able to edit splash.md without restarting the backend.
 */

import { Router } from 'express';
import fs from 'fs';
import { logger } from '../../../infrastructure/logging/index.js';
import { parseSplashFile, type SplashContent } from '../../../services/splash/splashFile.js';
import { resolveSplashPath, DEFAULT_SPLASH_PATH } from '../../../services/splash/splashPath.js';

const router = Router();

function tryReadAndParse(filePath: string): SplashContent | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    logger.warn(
      `[splash] Could not read splash file at ${filePath}: ${(err as Error).message}`,
    );
    return null;
  }
  const parsed = parseSplashFile(raw);
  if (!parsed) {
    logger.warn(
      `[splash] Splash file at ${filePath} has missing or malformed frontmatter`,
    );
    return null;
  }
  return parsed;
}

router.get('/splash', (_req, res) => {
  if (process.env.NOMAD_SPLASH_ENABLED !== 'true') {
    return res.json({ enabled: false });
  }

  const filePath = resolveSplashPath({
    NOMAD_SPLASH_PATH: process.env.NOMAD_SPLASH_PATH,
  });

  let parsed = tryReadAndParse(filePath);

  // If the configured path failed AND it isn't the default already,
  // fall back to the bundled default so ENABLED=true always shows something.
  if (!parsed && filePath !== DEFAULT_SPLASH_PATH) {
    parsed = tryReadAndParse(DEFAULT_SPLASH_PATH);
  }

  if (!parsed) {
    return res.json({ enabled: false });
  }

  return res.json({
    enabled: true,
    version: parsed.version,
    title: parsed.title,
    body: parsed.body,
    dismissable: true,
  });
});

export default router;
