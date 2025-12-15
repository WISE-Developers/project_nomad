import { Router } from 'express';

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
router.get('/health', (_req, res) => {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  const deploymentMode = (process.env.NOMAD_DEPLOYMENT_MODE?.toUpperCase() as 'SAN' | 'ACN') || 'SAN';

  // TODO: Add real database and engine checks when implemented
  const health = {
    status: 'healthy' as const,
    timestamp: new Date().toISOString(),
    uptime: uptimeSeconds,
    deploymentMode,
    checks: {
      database: {
        status: 'not_configured',
      },
      engines: {
        FireSTARR: { available: false, version: null },
        WISE: { available: false, version: null },
      },
    },
  };

  // Determine overall status based on checks
  // For now, always healthy since we don't have real checks yet
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
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    deploymentMode: (process.env.NOMAD_DEPLOYMENT_MODE as 'SAN' | 'ACN') || 'SAN',
    capabilities: {
      engines: ['FireSTARR', 'WISE'],
      maxJobDuration: 240, // 4 hours in minutes
    },
  };

  res.json(info);
});

export default router;
