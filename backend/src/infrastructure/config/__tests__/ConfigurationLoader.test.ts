/**
 * ConfigurationLoader Regression Tests
 *
 * Ensures configuration loading behavior remains stable as we extend
 * the configuration system for ACN support.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigurationLoader } from '../ConfigurationLoader.js';
import { ConfigurationValidator } from '../ConfigurationValidator.js';
import { IEnvironmentService } from '../../../application/interfaces/index.js';

// Mock environment service
function createMockEnvService(options: {
  mode?: 'SAN' | 'ACN';
  agencyId?: string;
} = {}): IEnvironmentService {
  return {
    getDeploymentMode: () => options.mode || 'SAN',
    getAgencyId: () => options.agencyId,
    get: () => undefined,
    getRequired: () => '',
    getOrDefault: (key: string, def: string) => def,
    isProduction: () => false,
    isDevelopment: () => true,
    isTest: () => false,
    getNodeEnv: () => 'test',
  };
}

// Mock validator that always passes
function createMockValidator(): ConfigurationValidator {
  const validator = new ConfigurationValidator();
  vi.spyOn(validator, 'validate').mockReturnValue({ valid: true, errors: [] });
  return validator;
}

describe('ConfigurationLoader', () => {
  const testConfigDir = path.join(process.cwd(), 'src/infrastructure/config/__tests__/fixtures');

  beforeEach(() => {
    ConfigurationLoader.resetInstance();
    // Create test fixtures directory
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
    if (!fs.existsSync(path.join(testConfigDir, 'generic'))) {
      fs.mkdirSync(path.join(testConfigDir, 'generic'), { recursive: true });
    }
  });

  afterEach(() => {
    ConfigurationLoader.resetInstance();
    // Clean up test fixtures
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('default configuration', () => {
    it('returns valid config when no config file exists', () => {
      const envService = createMockEnvService();
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      const config = loader.getConfig();

      expect(config).toBeDefined();
      expect(config.version).toBe('2.0');
      expect(config.deploymentMode).toBe('SAN');
      expect(config.agencyId).toBe('generic');
    });

    it('has required default sections', () => {
      const envService = createMockEnvService();
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      const config = loader.getConfig();

      expect(config.auth).toBeDefined();
      expect(config.auth.provider).toBe('simple');
      expect(config.branding).toBeDefined();
      expect(config.engines).toBeDefined();
      expect(config.engines.length).toBeGreaterThan(0);
      expect(config.dataSources).toBeDefined();
      expect(config.exportOptions).toBeDefined();
      expect(config.features).toBeDefined();
    });

    it('has firestarr engine enabled by default', () => {
      const envService = createMockEnvService();
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      expect(loader.isEngineEnabled('firestarr')).toBe(true);
      expect(loader.getEnabledEngines().length).toBeGreaterThan(0);
    });
  });

  describe('config file loading', () => {
    it('loads generic config when it exists', () => {
      // Create test config
      const genericConfig = {
        version: '2.0',
        agencyId: 'test-generic',
        agencyName: 'Test Generic',
        deploymentMode: 'SAN',
        environment: 'development',
        auth: { provider: 'simple', roleMappings: [], allowAnonymous: true },
        branding: { displayName: 'Test' },
        engines: [],
        dataSources: { weather: [], wildfirePoints: [], fuelTypes: [] },
        roles: [],
        exportOptions: {
          allowZipDownload: true,
          allowShareableLink: false,
          allowAgencyStorage: false,
          availableFormats: ['geojson'],
        },
        features: { enabled: [], suppressedEngines: [], suppressedFeatures: [] },
        suppressDefaultSources: false,
      };
      fs.writeFileSync(
        path.join(testConfigDir, 'generic', 'config.json'),
        JSON.stringify(genericConfig)
      );

      const envService = createMockEnvService();
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      expect(loader.getConfig().agencyName).toBe('Test Generic');
      expect(loader.getConfigPath()).toContain('generic/config.json');
    });

    it('loads agency config when agency ID is set', () => {
      // Create agency config directory and file
      const agencyDir = path.join(testConfigDir, 'test-agency');
      fs.mkdirSync(agencyDir, { recursive: true });

      const agencyConfig = {
        version: '2.0',
        agencyId: 'test-agency',
        agencyName: 'Test Agency',
        deploymentMode: 'ACN',
        environment: 'production',
        auth: { provider: 'oidc', roleMappings: [], allowAnonymous: false },
        branding: { displayName: 'Test Agency', primaryColor: '#ff0000' },
        engines: [],
        dataSources: { weather: [], wildfirePoints: [], fuelTypes: [] },
        roles: [],
        exportOptions: {
          allowZipDownload: true,
          allowShareableLink: true,
          allowAgencyStorage: true,
          availableFormats: ['geojson', 'kml'],
        },
        features: { enabled: ['model-setup'], suppressedEngines: [], suppressedFeatures: [] },
        suppressDefaultSources: true,
      };
      fs.writeFileSync(
        path.join(agencyDir, 'config.json'),
        JSON.stringify(agencyConfig)
      );

      const envService = createMockEnvService({ agencyId: 'test-agency' });
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      expect(loader.getConfig().agencyName).toBe('Test Agency');
      expect(loader.getConfig().branding.primaryColor).toBe('#ff0000');
      expect(loader.getConfigPath()).toContain('test-agency/config.json');
    });

    it('falls back to generic when agency config not found', () => {
      // Create only generic config
      const genericConfig = {
        version: '2.0',
        agencyId: 'generic',
        agencyName: 'Fallback Generic',
        deploymentMode: 'SAN',
        environment: 'development',
        auth: { provider: 'simple', roleMappings: [], allowAnonymous: true },
        branding: {},
        engines: [],
        dataSources: { weather: [], wildfirePoints: [], fuelTypes: [] },
        roles: [],
        exportOptions: {
          allowZipDownload: true,
          allowShareableLink: true,
          allowAgencyStorage: false,
          availableFormats: ['geojson'],
        },
        features: { enabled: [], suppressedEngines: [], suppressedFeatures: [] },
        suppressDefaultSources: false,
      };
      fs.writeFileSync(
        path.join(testConfigDir, 'generic', 'config.json'),
        JSON.stringify(genericConfig)
      );

      // Request non-existent agency
      const envService = createMockEnvService({ agencyId: 'nonexistent' });
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      expect(loader.getConfig().agencyName).toBe('Fallback Generic');
      expect(loader.getConfigPath()).toContain('generic/config.json');
    });
  });

  describe('environment override', () => {
    it('overrides deployment mode from environment', () => {
      // Config says SAN, but env says ACN
      const genericConfig = {
        version: '2.0',
        agencyId: 'generic',
        agencyName: 'Test',
        deploymentMode: 'SAN', // Config says SAN
        environment: 'development',
        auth: { provider: 'simple', roleMappings: [], allowAnonymous: true },
        branding: {},
        engines: [],
        dataSources: { weather: [], wildfirePoints: [], fuelTypes: [] },
        roles: [],
        exportOptions: {
          allowZipDownload: true,
          allowShareableLink: true,
          allowAgencyStorage: false,
          availableFormats: [],
        },
        features: { enabled: [], suppressedEngines: [], suppressedFeatures: [] },
        suppressDefaultSources: false,
      };
      fs.writeFileSync(
        path.join(testConfigDir, 'generic', 'config.json'),
        JSON.stringify(genericConfig)
      );

      const envService = createMockEnvService({ mode: 'ACN' }); // Env says ACN
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      // Environment wins
      expect(loader.getDeploymentMode()).toBe('ACN');
    });

    it('overrides agency ID from environment', () => {
      const genericConfig = {
        version: '2.0',
        agencyId: 'config-agency', // Config says one thing
        agencyName: 'Test',
        deploymentMode: 'SAN',
        environment: 'development',
        auth: { provider: 'simple', roleMappings: [], allowAnonymous: true },
        branding: {},
        engines: [],
        dataSources: { weather: [], wildfirePoints: [], fuelTypes: [] },
        roles: [],
        exportOptions: {
          allowZipDownload: true,
          allowShareableLink: true,
          allowAgencyStorage: false,
          availableFormats: [],
        },
        features: { enabled: [], suppressedEngines: [], suppressedFeatures: [] },
        suppressDefaultSources: false,
      };
      fs.writeFileSync(
        path.join(testConfigDir, 'generic', 'config.json'),
        JSON.stringify(genericConfig)
      );

      const envService = createMockEnvService({ agencyId: 'env-agency' }); // Env says another
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      // Environment wins
      expect(loader.getAgencyId()).toBe('env-agency');
    });
  });

  describe('helper methods', () => {
    it('isSAN returns true in SAN mode', () => {
      const envService = createMockEnvService({ mode: 'SAN' });
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      expect(loader.isSAN()).toBe(true);
      expect(loader.isACN()).toBe(false);
    });

    it('isACN returns true in ACN mode', () => {
      const envService = createMockEnvService({ mode: 'ACN' });
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      expect(loader.isSAN()).toBe(false);
      expect(loader.isACN()).toBe(true);
    });

    it('get() retrieves nested values', () => {
      const envService = createMockEnvService();
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      expect(loader.get('auth.provider')).toBe('simple');
      expect(loader.get('nonexistent.path', 'default')).toBe('default');
    });

    it('getBranding returns branding config', () => {
      const envService = createMockEnvService();
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      const branding = loader.getBranding();
      expect(branding).toBeDefined();
    });

    it('getExportOptions returns export config', () => {
      const envService = createMockEnvService();
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      const options = loader.getExportOptions();
      expect(options.allowZipDownload).toBe(true);
    });
  });

  describe('reload', () => {
    it('reloads configuration from file', async () => {
      // Initial config - use a distinct branding color we can track
      const initialConfig = {
        version: '2.0',
        agencyId: 'generic',
        agencyName: 'Test Agency',
        deploymentMode: 'SAN',
        environment: 'development',
        auth: { provider: 'simple', roleMappings: [], allowAnonymous: true },
        branding: { primaryColor: '#111111' },
        engines: [],
        dataSources: { weather: [], wildfirePoints: [], fuelTypes: [] },
        roles: [],
        exportOptions: {
          allowZipDownload: true,
          allowShareableLink: true,
          allowAgencyStorage: false,
          availableFormats: [],
        },
        features: { enabled: [], suppressedEngines: [], suppressedFeatures: [] },
        suppressDefaultSources: false,
      };
      fs.writeFileSync(
        path.join(testConfigDir, 'generic', 'config.json'),
        JSON.stringify(initialConfig)
      );

      const envService = createMockEnvService();
      const validator = createMockValidator();
      const loader = new ConfigurationLoader(envService, testConfigDir, validator);

      expect(loader.getConfig().branding.primaryColor).toBe('#111111');

      // Update config with new color
      initialConfig.branding.primaryColor = '#222222';
      fs.writeFileSync(
        path.join(testConfigDir, 'generic', 'config.json'),
        JSON.stringify(initialConfig)
      );

      await loader.reload();

      expect(loader.getConfig().branding.primaryColor).toBe('#222222');
    });
  });
});
