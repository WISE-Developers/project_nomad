/**
 * Auth Providers Route
 *
 * Returns which OAuth providers are configured.
 * Used by the frontend to render only the available login buttons.
 */

import { Router } from 'express';

const router = Router();

interface ProviderInfo {
  id: string;
  name: string;
}

const PROVIDER_MAP: Record<string, { envPrefix: string; name: string }> = {
  google: { envPrefix: 'NOMAD_OAUTH_GOOGLE', name: 'Google' },
  microsoft: { envPrefix: 'NOMAD_OAUTH_MICROSOFT', name: 'Microsoft' },
  github: { envPrefix: 'NOMAD_OAUTH_GITHUB', name: 'GitHub' },
  apple: { envPrefix: 'NOMAD_OAUTH_APPLE', name: 'Apple' },
  discord: { envPrefix: 'NOMAD_OAUTH_DISCORD', name: 'Discord' },
  facebook: { envPrefix: 'NOMAD_OAUTH_FACEBOOK', name: 'Facebook' },
  twitter: { envPrefix: 'NOMAD_OAUTH_TWITTER', name: 'Twitter/X' },
};

router.get('/auth/providers', (_req, res) => {
  const providers: ProviderInfo[] = [];

  for (const [id, config] of Object.entries(PROVIDER_MAP)) {
    const clientId = process.env[`${config.envPrefix}_CLIENT_ID`];
    const clientSecret = process.env[`${config.envPrefix}_CLIENT_SECRET`];
    if (clientId && clientSecret && !clientId.startsWith('your-')) {
      providers.push({ id, name: config.name });
    }
  }

  res.json({ providers });
});

export default router;
