/**
 * GET /api/v1/splash — configurable splash screen content (#275).
 *
 * Always returns 200. When disabled (env not set or file unreadable), returns
 * { enabled: false } so the frontend can branch without handling errors.
 *
 * The file is read fresh on each request — content is tiny and operators
 * should be able to edit splash.md without restarting the backend.
 */

import { Router } from 'express';
import fs from 'fs';
import { logger } from '../../../infrastructure/logging/index.js';
import { parseSplashFile } from '../../../services/splash/splashFile.js';
import { resolveSplashPath } from '../../../services/splash/splashPath.js';

const router = Router();

router.get('/splash', (_req, res) => {
  if (process.env.NOMAD_SPLASH_ENABLED !== 'true') {
    return res.json({ enabled: false });
  }

  const filePath = resolveSplashPath({
    NOMAD_SPLASH_PATH: process.env.NOMAD_SPLASH_PATH,
    NOMAD_DATA_PATH: process.env.NOMAD_DATA_PATH,
  });

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    logger.warn(
      `[splash] Could not read splash file at ${filePath}: ${(err as Error).message}`,
    );
    return res.json({ enabled: false });
  }

  const parsed = parseSplashFile(raw);
  if (!parsed) {
    logger.warn(
      `[splash] Splash file at ${filePath} has missing or malformed frontmatter`,
    );
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
