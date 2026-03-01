import { Router } from 'express';
import healthRouter from './health.js';
import configRouter from './config.js';
import jobsRouter from './jobs.js';
import modelsRouter from './models.js';
import resultsRouter from './results.js';
import exportsRouter from './exports.js';
import settingsRouter from './settings.js';
import notificationsRouterFactory from './notifications.js';
import { getNotificationPreferencesRepository } from '../../../infrastructure/database/index.js';

const router = Router();

// Mount sub-routers
router.use(healthRouter);   // /health, /info
router.use(configRouter);   // /config
router.use(jobsRouter);     // /jobs/:id
router.use(modelsRouter);   // /models/:id, /models/:id/execute, /models/:id/results
router.use(resultsRouter);  // /results/:id/preview, /results/:id/download
router.use(exportsRouter);  // /exports, /exports/:id/download, /exports/:id/share, /share/:token
router.use(settingsRouter); // /settings/:key
router.use(notificationsRouterFactory(getNotificationPreferencesRepository()));  // /notifications/preferences

export default router;
