/**
 * Notification Preferences API Routes
 *
 * GET  /notifications/preferences  — Fetch all preferences for the current user
 * PUT  /notifications/preferences  — Upsert preferences for the current user
 *
 * User identity comes from the X-Nomad-User header (simple auth, SAN mode).
 * When the header is absent the user is treated as "anonymous".
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../middleware/index.js';
import { INotificationPreferencesRepository } from '../../../application/interfaces/INotificationPreferencesRepository.js';
import {
  DEFAULT_EVENT_TYPES,
  NotificationEventType,
} from '../../../infrastructure/database/migrations/005_create_notification_preferences.js';

const ANONYMOUS_USER = 'anonymous';

function getUserId(req: Request): string {
  const header = req.headers['x-nomad-user'];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }
  return ANONYMOUS_USER;
}

/**
 * Factory function — accepts the repository so it can be injected in tests
 * without touching the global singleton.
 */
export default function notificationsRouter(
  repo: INotificationPreferencesRepository
): Router {
  const router = Router();

  /**
   * @openapi
   * /notifications/preferences:
   *   get:
   *     summary: Get notification preferences for the current user
   *     tags: [Notifications]
   *     parameters:
   *       - in: header
   *         name: X-Nomad-User
   *         schema:
   *           type: string
   *         description: User identifier (simple auth)
   *     responses:
   *       200:
   *         description: Array of notification preferences
   */
  router.get(
    '/notifications/preferences',
    asyncHandler(async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const preferences = await repo.getByUserId(userId);
      res.json({ preferences });
    })
  );

  /**
   * @openapi
   * /notifications/preferences:
   *   put:
   *     summary: Update notification preferences for the current user
   *     tags: [Notifications]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [preferences]
   *             properties:
   *               preferences:
   *                 type: array
   *                 items:
   *                   type: object
   *                   required: [eventType, toastEnabled, browserEnabled]
   *                   properties:
   *                     eventType:
   *                       type: string
   *                       enum: [model_completed, model_failed, import_completed, import_failed]
   *                     toastEnabled:
   *                       type: boolean
   *                     browserEnabled:
   *                       type: boolean
   *     responses:
   *       200:
   *         description: Saved preferences
   *       400:
   *         description: Validation error
   */
  router.put(
    '/notifications/preferences',
    asyncHandler(async (req: Request, res: Response) => {
      const userId = getUserId(req);
      const { preferences } = req.body as { preferences?: unknown };

      if (!Array.isArray(preferences)) {
        res.status(400).json({ error: '"preferences" must be an array' });
        return;
      }

      // Validate each preference entry
      const validEventTypes = new Set<string>(DEFAULT_EVENT_TYPES);

      for (const item of preferences) {
        if (typeof item !== 'object' || item === null) {
          res.status(400).json({ error: 'Each preference must be an object' });
          return;
        }

        const { eventType } = item as Record<string, unknown>;

        if (typeof eventType !== 'string' || !validEventTypes.has(eventType)) {
          res.status(400).json({
            error: `Invalid eventType "${eventType}". Must be one of: ${DEFAULT_EVENT_TYPES.join(', ')}`,
          });
          return;
        }
      }

      // Build preference objects
      const prefsToSave = (preferences as Array<{ eventType: string; toastEnabled: unknown; browserEnabled: unknown }>).map(
        (item) => ({
          userId,
          eventType: item.eventType as NotificationEventType,
          toastEnabled: Boolean(item.toastEnabled),
          browserEnabled: Boolean(item.browserEnabled),
        })
      );

      const saved = await repo.saveAll(prefsToSave);
      res.json({ preferences: saved });
    })
  );

  return router;
}
