import * as fs from 'fs';
import * as path from 'path';
import {
  IConfigurationService,
  IEnvironmentService,
  DeploymentMode,
  ApplicationConfig,
  AgencyBrandingConfig,
  EngineConfig,
  DataSourceConfig,
  RoleConfig,
  ExportOptionsConfig,
} from '../../application/interfaces/index.js';
import { EngineType } from '../../domain/entities/index.js';

/**
 * Default configuration used as base and fallback.
 */
const DEFAULT_CONFIG: ApplicationConfig = {
  agencyId: 'generic',
  agencyName: 'Project Nomad',
  deploymentMode: 'SAN',
  branding: {},
  engines: [
    { engineType: 'firestarr' as EngineType, enabled: true, settings: {} },
  ],
  dataSources: {
    weather: [],
    wildfirePoints: [],
    fuelTypes: [],
  },
  roles: [],
  exportOptions: {
    allowZipDownload: true,
    allowShareableLink: true,
    allowAgencyStorage: false,
    availableFormats: ['geojson', 'kml', 'shapefile'],
  },
  suppressDefaultSources: false,
};

/**
 * Implementation of IConfigurationService that loads configuration from JSON files.
 *
 * Configuration loading priority:
 * 1. Agency-specific config: /configuration/{agencyId}/config.json
 * 2. Generic config: /configuration/generic/config.json
 * 3. Built-in defaults
 *
 * Agency config is merged with defaults (agency values override).
 */
export class ConfigurationLoader implements IConfigurationService {
  private static instance: ConfigurationLoader | null = null;
  private config: ApplicationConfig;
  private configPath: string | null = null;
  private readonly configBasePath: string;

  constructor(
    private readonly envService: IEnvironmentService,
    configBasePath?: string
  ) {
    // Default to /configuration at project root
    this.configBasePath = configBasePath || path.resolve(process.cwd(), 'configuration');
    this.config = this.loadConfiguration();
  }

  /**
   * Gets the singleton instance of ConfigurationLoader.
   *
   * @param envService - Environment service for reading env vars
   * @param configBasePath - Optional override for configuration directory
   */
  static getInstance(envService: IEnvironmentService, configBasePath?: string): ConfigurationLoader {
    if (!ConfigurationLoader.instance) {
      ConfigurationLoader.instance = new ConfigurationLoader(envService, configBasePath);
    }
    return ConfigurationLoader.instance;
  }

  /**
   * Resets the singleton instance (for testing).
   */
  static resetInstance(): void {
    ConfigurationLoader.instance = null;
  }

  getDeploymentMode(): DeploymentMode {
    return this.config.deploymentMode;
  }

  getAgencyId(): string {
    return this.config.agencyId;
  }

  getConfig(): ApplicationConfig {
    return this.config;
  }

  getBranding(): AgencyBrandingConfig {
    return this.config.branding;
  }

  getEnabledEngines(): EngineConfig[] {
    return this.config.engines.filter((e) => e.enabled);
  }

  isEngineEnabled(engineType: EngineType): boolean {
    const engine = this.config.engines.find((e) => e.engineType === engineType);
    return engine?.enabled ?? false;
  }

  getEngineConfig(engineType: EngineType): EngineConfig | undefined {
    return this.config.engines.find((e) => e.engineType === engineType);
  }

  getDataSources(category: 'weather' | 'wildfirePoints' | 'fuelTypes'): DataSourceConfig[] {
    return this.config.dataSources[category];
  }

  getRoleConfig(internalRole: string): RoleConfig | undefined {
    return this.config.roles.find((r) => r.internalRole === internalRole);
  }

  getExportOptions(): ExportOptionsConfig {
    return this.config.exportOptions;
  }

  get<T>(pathStr: string, defaultValue?: T): T | undefined {
    const parts = pathStr.split('.');
    let current: unknown = this.config;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return defaultValue;
      }
      if (typeof current !== 'object') {
        return defaultValue;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return (current as T) ?? defaultValue;
  }

  isSAN(): boolean {
    return this.config.deploymentMode === 'SAN';
  }

  isACN(): boolean {
    return this.config.deploymentMode === 'ACN';
  }

  async reload(): Promise<void> {
    this.config = this.loadConfiguration();
  }

  /**
   * Gets the path to the loaded configuration file.
   *
   * @returns Path to config file or null if using defaults
   */
  getConfigPath(): string | null {
    return this.configPath;
  }

  private loadConfiguration(): ApplicationConfig {
    const agencyId = this.envService.getAgencyId();
    const deploymentMode = this.envService.getDeploymentMode();

    let loadedConfig: Partial<ApplicationConfig> = {};

    // Try to load agency-specific config
    if (agencyId) {
      const agencyConfigPath = path.join(this.configBasePath, agencyId, 'config.json');
      const agencyConfig = this.tryLoadConfigFile(agencyConfigPath);
      if (agencyConfig) {
        loadedConfig = agencyConfig;
        this.configPath = agencyConfigPath;
        console.log(`[ConfigurationLoader] Loaded agency config: ${agencyConfigPath}`);
      }
    }

    // If no agency config, try generic
    if (!this.configPath) {
      const genericConfigPath = path.join(this.configBasePath, 'generic', 'config.json');
      const genericConfig = this.tryLoadConfigFile(genericConfigPath);
      if (genericConfig) {
        loadedConfig = genericConfig;
        this.configPath = genericConfigPath;
        console.log(`[ConfigurationLoader] Loaded generic config: ${genericConfigPath}`);
      }
    }

    // If still no config, use defaults
    if (!this.configPath) {
      console.log('[ConfigurationLoader] No config file found, using built-in defaults');
    }

    // Merge with defaults (loaded config overrides defaults)
    const mergedConfig = this.deepMerge(DEFAULT_CONFIG, loadedConfig);

    // Override deployment mode and agency ID from environment
    // Cast to mutable to allow environment overrides
    return {
      ...mergedConfig,
      deploymentMode,
      agencyId: agencyId || mergedConfig.agencyId,
    };
  }

  private tryLoadConfigFile(configPath: string): Partial<ApplicationConfig> | null {
    try {
      if (!fs.existsSync(configPath)) {
        return null;
      }

      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content);

      return parsed as Partial<ApplicationConfig>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[ConfigurationLoader] Failed to load ${configPath}: ${message}`);
      return null;
    }
  }

  private deepMerge(
    base: ApplicationConfig,
    override: Partial<ApplicationConfig>
  ): ApplicationConfig {
    const result = { ...base };

    for (const key of Object.keys(override) as Array<keyof ApplicationConfig>) {
      const overrideValue = override[key];
      const baseValue = base[key];

      if (overrideValue === undefined) {
        continue;
      }

      if (
        typeof overrideValue === 'object' &&
        overrideValue !== null &&
        !Array.isArray(overrideValue) &&
        typeof baseValue === 'object' &&
        baseValue !== null &&
        !Array.isArray(baseValue)
      ) {
        // Recursively merge nested objects
        (result as Record<string, unknown>)[key] = {
          ...baseValue,
          ...overrideValue,
        };
      } else {
        // Override value directly (including arrays)
        (result as Record<string, unknown>)[key] = overrideValue;
      }
    }

    return result;
  }
}
