import { Router } from 'express';

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
  // TODO: Load from ConfigurationService when integrated
  const config = {
    deploymentMode: process.env.NOMAD_DEPLOYMENT_MODE || 'SAN',
    branding: {
      name: 'Project Nomad',
      logoUrl: null,
      primaryColor: '#2563eb',
    },
    features: {
      engines: ['FireSTARR', 'WISE'],
      exportFormats: ['GeoJSON', 'GeoTIFF', 'Shapefile', 'KML'],
    },
  };

  res.json(config);
});

export default router;
