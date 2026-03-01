/**
 * Settings API Route
 *
 * Manages application settings stored in the database.
 * DB values override env vars; DELETE removes the UI override.
 *
 * GET    /api/v1/settings/:key  — retrieve a setting (DB or env)
 * PUT    /api/v1/settings/:key  — upsert a setting
 * DELETE /api/v1/settings/:key  — remove UI override
 */

import { Router } from 'express';
import { KnexSettingsRepository } from '../../../infrastructure/database/repositories/KnexSettingsRepository.js';

const router = Router();

/**
 * GET /api/v1/settings/:key
 *
 * Returns the setting value (DB overrides env).
 * 404 if neither DB nor env has a value.
 */
router.get('/settings/:key', async (req, res) => {
  const { key } = req.params;
  const repo = new KnexSettingsRepository();

  try {
    const result = await repo.getWithSource(key);

    if (!result) {
      res.status(404).json({ error: `Setting '${key}' not found` });
      return;
    }

    res.json({ key, value: result.value, source: result.source });
  } catch (err) {
    console.error('[Settings] GET error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/settings/:key
 *
 * Upserts a setting. Body must contain { value: string }.
 */
router.put('/settings/:key', async (req, res) => {
  const { key } = req.params;
  const { value } = req.body as { value?: unknown };

  if (value === undefined || value === null || typeof value !== 'string') {
    res.status(400).json({ error: 'Request body must include a string "value" field' });
    return;
  }

  const repo = new KnexSettingsRepository();

  try {
    await repo.set(key, value);
    res.json({ key, value, source: 'db' });
  } catch (err) {
    console.error('[Settings] PUT error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/v1/settings/:key
 *
 * Removes the UI override for a key (reverts to env var default).
 */
router.delete('/settings/:key', async (req, res) => {
  const { key } = req.params;
  const repo = new KnexSettingsRepository();

  try {
    const deleted = await repo.delete(key);
    res.json({ key, deleted });
  } catch (err) {
    console.error('[Settings] DELETE error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
