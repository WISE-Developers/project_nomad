import { EngineType } from '../../domain/entities/index.js';

/**
 * Deployment mode for the application
 */
export type DeploymentMode = 'SAN' | 'ACN';

/**
 * Environment type
 */
export type Environment = 'development' | 'staging' | 'production';

/**
 * Authentication provider type
 */
export type AuthProvider = 'none' | 'simple' | 'oidc' | 'saml';

/**
 * OIDC authentication configuration
 */
export interface OIDCConfig {
  /** OIDC issuer URL */
  readonly issuer: string;
  /** Client ID */
  readonly clientId: string;
  /** Client secret (for confidential clients) */
  readonly clientSecret?: string;
  /** Requested scopes */
  readonly scopes: string[];
  /** Authorization endpoint override */
  readonly authorizationEndpoint?: string;
  /** Token endpoint override */
  readonly tokenEndpoint?: string;
  /** User info endpoint override */
  readonly userInfoEndpoint?: string;
}

/**
 * SAML authentication configuration
 */
export interface SAMLConfig {
  /** Identity Provider metadata URL */
  readonly idpMetadataUrl: string;
  /** Service Provider entity ID */
  readonly spEntityId: string;
  /** Assertion Consumer Service URL */
  readonly acsUrl: string;
  /** Single Logout URL */
  readonly sloUrl?: string;
  /** Certificate for signing */
  readonly certificate?: string;
}

/**
 * Role mapping from external auth provider to internal roles
 */
export interface RoleMapping {
  /** External role/group name from auth provider */
  readonly externalRole: string;
  /** Internal Nomad role name */
  readonly internalRole: string;
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  /** Authentication provider type */
  readonly provider: AuthProvider;
  /** OIDC configuration (when provider is 'oidc') */
  readonly oidc?: OIDCConfig;
  /** SAML configuration (when provider is 'saml') */
  readonly saml?: SAMLConfig;
  /** Role mappings from external to internal roles */
  readonly roleMappings: RoleMapping[];
  /** Session timeout in minutes */
  readonly sessionTimeout?: number;
  /** Allow anonymous access */
  readonly allowAnonymous: boolean;
}

/**
 * Feature toggle configuration
 */
export interface FeaturesConfig {
  /** List of enabled feature flags */
  readonly enabled: string[];
  /** List of suppressed/disabled engines */
  readonly suppressedEngines: EngineType[];
  /** List of suppressed features */
  readonly suppressedFeatures: string[];
}

/**
 * Data source configuration
 */
export interface DataSourceConfig {
  /** Source identifier */
  readonly id: string;
  /** Display name */
  readonly name: string;
  /** Source URL(s) */
  readonly urls: string[];
  /** Source type (API, OWS) */
  readonly type: 'API' | 'OWS';
  /** Kind of service (REST, WFS, WCS) */
  readonly kind: 'REST' | 'WFS' | 'WCS';
  /** Whether this is a default/national source */
  readonly isDefault: boolean;
}

/**
 * Agency branding configuration
 */
export interface AgencyBrandingConfig {
  /** Agency logo URL */
  readonly logoUrl?: string;
  /** Primary brand color */
  readonly primaryColor?: string;
  /** Secondary brand color */
  readonly secondaryColor?: string;
  /** Agency name for display */
  readonly displayName?: string;
}

/**
 * User role configuration
 */
export interface RoleConfig {
  /** Internal role name */
  readonly internalRole: string;
  /** Agency-specific role name mapping */
  readonly agencyRole?: string;
  /** Permissions for this role */
  readonly permissions: string[];
}

/**
 * Export options configuration
 */
export interface ExportOptionsConfig {
  /** Allow direct ZIP download */
  readonly allowZipDownload: boolean;
  /** Allow shareable link generation */
  readonly allowShareableLink: boolean;
  /** Allow saving to agency storage */
  readonly allowAgencyStorage: boolean;
  /** Available export formats */
  readonly availableFormats: string[];
}

/**
 * Fire modeling engine configuration
 */
export interface EngineConfig {
  /** Engine type */
  readonly engineType: EngineType;
  /** Whether engine is enabled */
  readonly enabled: boolean;
  /** Engine-specific settings */
  readonly settings: Record<string, unknown>;
}

/**
 * Full application configuration
 */
export interface ApplicationConfig {
  /** Schema version for migration support */
  readonly version: '2.0';
  /** Agency identifier */
  readonly agencyId: string;
  /** Agency name */
  readonly agencyName: string;
  /** Deployment mode */
  readonly deploymentMode: DeploymentMode;
  /** Environment (dev/staging/prod) */
  readonly environment: Environment;
  /** Authentication configuration */
  readonly auth: AuthConfig;
  /** Agency branding */
  readonly branding: AgencyBrandingConfig;
  /** Available engines */
  readonly engines: EngineConfig[];
  /** Data sources by category */
  readonly dataSources: {
    weather: DataSourceConfig[];
    wildfirePoints: DataSourceConfig[];
    fuelTypes: DataSourceConfig[];
  };
  /** Role mappings (legacy - use auth.roleMappings for external auth) */
  readonly roles: RoleConfig[];
  /** Export options */
  readonly exportOptions: ExportOptionsConfig;
  /** Feature toggles */
  readonly features: FeaturesConfig;
  /** Whether to suppress default/national data sources */
  readonly suppressDefaultSources: boolean;
}

/**
 * Interface for accessing application configuration.
 *
 * Configuration is loaded from external JSON files and can vary by:
 * - Deployment mode (SAN vs ACN)
 * - Agency (NWT, Alberta, Ontario, etc.)
 * - Environment (dev, staging, production)
 */
export interface IConfigurationService {
  /**
   * Gets the current deployment mode.
   *
   * @returns 'SAN' for Stand Alone Nomad, 'ACN' for Agency Centric Nomad
   */
  getDeploymentMode(): DeploymentMode;

  /**
   * Gets the current agency ID.
   *
   * @returns Agency identifier (e.g., 'nwt', 'generic')
   */
  getAgencyId(): string;

  /**
   * Gets the full application configuration.
   *
   * @returns Complete configuration object
   */
  getConfig(): ApplicationConfig;

  /**
   * Gets agency branding configuration.
   *
   * @returns Branding settings
   */
  getBranding(): AgencyBrandingConfig;

  /**
   * Gets enabled fire modeling engines.
   *
   * @returns List of enabled engine configurations
   */
  getEnabledEngines(): EngineConfig[];

  /**
   * Checks if a specific engine is enabled.
   *
   * @param engineType - Engine to check
   * @returns Whether engine is enabled
   */
  isEngineEnabled(engineType: EngineType): boolean;

  /**
   * Gets engine-specific configuration.
   *
   * @param engineType - Engine type
   * @returns Engine configuration if exists
   */
  getEngineConfig(engineType: EngineType): EngineConfig | undefined;

  /**
   * Gets data sources for a category.
   *
   * @param category - Data category (weather, wildfirePoints, fuelTypes)
   * @returns Data source configurations
   */
  getDataSources(category: 'weather' | 'wildfirePoints' | 'fuelTypes'): DataSourceConfig[];

  /**
   * Gets role configuration.
   *
   * @param internalRole - Internal role name
   * @returns Role configuration if exists
   */
  getRoleConfig(internalRole: string): RoleConfig | undefined;

  /**
   * Gets export options.
   *
   * @returns Export configuration
   */
  getExportOptions(): ExportOptionsConfig;

  /**
   * Gets a specific configuration value by path.
   *
   * @param path - Dot-separated path (e.g., 'branding.primaryColor')
   * @param defaultValue - Default if path not found
   * @returns Configuration value
   */
  get<T>(path: string, defaultValue?: T): T | undefined;

  /**
   * Checks if running in SAN (Stand Alone Nomad) mode.
   *
   * @returns True if SAN mode
   */
  isSAN(): boolean;

  /**
   * Checks if running in ACN (Agency Centric Nomad) mode.
   *
   * @returns True if ACN mode
   */
  isACN(): boolean;

  /**
   * Reloads configuration from source.
   * Useful for hot-reloading in development.
   */
  reload(): Promise<void>;
}
