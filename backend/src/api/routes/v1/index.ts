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
import fuelDatasetsRouterFactory from './fuelDatasets.js';
import { getNotificationPreferencesRepository } from '../../../infrastructure/database/index.js';
import { usageRouter, isUsageEndpointEnabled, resolveUsageToken } from './usage.js';
import { createJsonlUsageLogger, getUsageLogger } from '../../../infrastructure/usage/index.js';
import { EnvironmentService } from '../../../infrastructure/config/EnvironmentService.js';
import { logger } from '../../../infrastructure/logging/index.js';
import { createFileSystemFuelDatasetCatalog } from '../../../infrastructure/firestarr/FileSystemFuelDatasetCatalog.js';

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

// Lazy-init for the same reason: the catalog reads FIRESTARR_DATASET_PATH,
// which dotenv has not loaded at import time.
let fuelDatasetsRouter: Router | null = null;
router.use((req, res, next) => {
  if (!fuelDatasetsRouter) {
    fuelDatasetsRouter = fuelDatasetsRouterFactory(createFileSystemFuelDatasetCatalog());
  }
  fuelDatasetsRouter(req, res, next);
});

// Usage endpoint (#332). FAIL CLOSED: mounted only when a token is configured.
// The log is a personnel-shaped record, so an unregistered route is the point -
// there is no handler for a middleware-ordering mistake to expose.
//
// Lazy for the same reason as the others: dotenv has not run at import time.
let usageRouterInstance: Router | null = null;
let usageEndpointResolved = false;
router.use((req, res, next) => {
  if (!usageEndpointResolved) {
    usageEndpointResolved = true;
    if (isUsageEndpointEnabled()) {
      const adapter = createJsonlUsageLogger();
      usageRouterInstance = usageRouter({
        query: adapter,
        usageLogger: getUsageLogger(),
        token: resolveUsageToken(),
        homeTimezone: EnvironmentService.getInstance().getHomeTimezone(),
      });
      logger.startup('Usage endpoint enabled at GET /api/v1/usage');
    }
  }

  if (!usageRouterInstance) {
    next();
    return;
  }
  usageRouterInstance(req, res, next);
});

export default router;
