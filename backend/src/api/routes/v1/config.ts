import { Router } from 'express';
import { ConfigurationLoader } from '../../../infrastructure/config/ConfigurationLoader.js';
import { EnvironmentService } from '../../../infrastructure/config/EnvironmentService.js';

const router = Router();

/**
 * @openapi
 * /config:
 *   get:
 *     summary: Get public configuration
 *     description: Returns public configuration settings for the client application
 *     tags: [Config]
 *     responses:
 *       200:
 *         description: Public configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deploymentMode:
 *                   type: string
 *                   enum: [SAN, ACN]
 *                 branding:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     logoUrl:
 *                       type: string
 *                     primaryColor:
 *                       type: string
 *                 features:
 *                   type: object
 *                   properties:
 *                     engines:
 *                       type: array
 *                       items:
 *                         type: string
 *                     exportFormats:
 *                       type: array
 *                       items:
 *                         type: string
 */
router.get('/config', (_req, res) => {
  const configService = ConfigurationLoader.getInstance(EnvironmentService.getInstance());
  const branding = configService.getBranding();
  const enabledEngines = configService.getEnabledEngines();
  const exportOptions = configService.getExportOptions();

  const config = {
    deploymentMode: configService.getDeploymentMode(),
    branding: {
      name: branding.displayName || 'Project Nomad',
      logoUrl: branding.logoUrl || null,
      primaryColor: branding.primaryColor || '#2563eb',
    },
    features: {
      engines: enabledEngines.map((e) => e.engineType),
      exportFormats: exportOptions.availableFormats,
    },
  };

  res.json(config);
});

export default router;
