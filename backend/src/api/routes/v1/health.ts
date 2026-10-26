import { Router } from 'express';
import {
  testConnection,
  getDatabaseClient,
  isKnexInitialized,
} from '../../../infrastructure/database/knex/KnexConnection.js';
import { getModelExecutionService } from '../../../infrastructure/services/index.js';
import { resolveAppVersion } from '../../../infrastructure/config/appVersion.js';
import { resolveAuthMode } from '../../middleware/authMode.js';

const router = Router();
const startTime = Date.now();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns detailed health status of the API and its dependencies
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Health'
 *       503:
 *         description: Service is unhealthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Health'
 */
router.get('/health', async (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  const deploymentMode = (process.env.NOMAD_DEPLOYMENT_MODE?.toUpperCase() as 'SAN' | 'ACN') || 'SAN';

  // Database check
  let dbStatus: 'healthy' | 'unhealthy' | 'not_configured' = 'not_configured';
  let dbClient: string | null = null;
  if (isKnexInitialized()) {
    dbClient = getDatabaseClient();
    const dbOk = await testConnection();
    dbStatus = dbOk ? 'healthy' : 'unhealthy';
  }

  // Engine availability checks
  const executionService = getModelExecutionService();
  const [firestarrAvailable, wiseAvailable] = await Promise.all([
    executionService.isEngineAvailable('FireSTARR'),
    executionService.isEngineAvailable('WISE'),
  ]);

  // Determine overall status
  const overallStatus = dbStatus === 'unhealthy' ? 'degraded' : 'healthy';

  const health = {
    status: overallStatus as 'healthy' | 'degraded',
    timestamp: new Date().toISOString(),
    uptime: uptimeSeconds,
    deploymentMode,
    checks: {
      database: {
        status: dbStatus,
        client: dbClient,
      },
      engines: {
        FireSTARR: { available: firestarrAvailable, version: null },
        WISE: { available: wiseAvailable, version: null },
      },
    },
  };

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * @openapi
 * /info:
 *   get:
 *     summary: API information endpoint
 *     description: Returns version and capability information about the API
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API information
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Info'
 */
router.get('/info', (_req, res) => {
  const info = {
    name: 'Project Nomad',
    version: resolveAppVersion(),
    environment: process.env.NODE_ENV || 'development',
    deploymentMode: (process.env.NOMAD_DEPLOYMENT_MODE as 'SAN' | 'ACN') || 'SAN',
    // THE SERVER IS THE AUTHORITY ON ITS OWN AUTH MODE (#474).
    //
    // The frontend used to read `import.meta.env.VITE_AUTH_MODE`, which Vite
    // inlines at BUILD time. Once CI published one image for every site (#465),
    // that constant carried the CI default — `simple` — to a demo running
    // `oauth`: the splash offered "Enter your name to continue" while the
    // server had Google and GitHub initialised. Runtime environment cannot
    // change a compiled bundle, so the client has to ask.
    authMode: resolveAuthMode(),
    capabilities: {
      engines: ['FireSTARR', 'WISE'],
      maxJobDuration: 240, // 4 hours in minutes
    },
  };

  res.json(info);
});

export default router;
