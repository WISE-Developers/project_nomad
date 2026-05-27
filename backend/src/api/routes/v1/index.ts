import { Router } from 'express';
import healthRouter from './health.js';
import configRouter from './config.js';
import jobsRouter from './jobs.js';
import modelsRouter from './models.js';
import resultsRouter from './results.js';
import exportsRouter from './exports.js';
import settingsRouter from './settings.js';
import authProvidersRouter from './authProviders.js';
import exportManifestRouter from './exportManifest.js';
import importRouter from './import.js';
import perimetersImportRouter from './perimetersImport.js';
import splashRouter from './splash.js';
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
router.use(settingsRouter);       // /settings/:key
router.use(authProvidersRouter);  // /auth/providers
router.use(exportManifestRouter); // /models/:id/export-manifest
router.use(importRouter);         // /import
router.use(perimetersImportRouter); // /perimeters/import
router.use(splashRouter);           // /splash

// Lazy-init: getNotificationPreferencesRepository() must NOT run at import time
// because dotenv hasn't loaded yet, causing wrong database path and double-init crash
let notificationRouter: Router | null = null;
router.use((req, res, next) => {
  if (!notificationRouter) {
    notificationRouter = notificationsRouterFactory(getNotificationPreferencesRepository());
  }
  notificationRouter(req, res, next);
});

export default router;
