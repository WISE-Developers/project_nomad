import { DeploymentMode } from './IConfigurationService.js';

/**
 * Interface for accessing environment variables.
 *
 * Abstracts environment variable access to enable:
 * - Testing with mocked values
 * - Validation of required variables
 * - Type-safe access to known variables
 */
export interface IEnvironmentService {
  /**
   * Gets the deployment mode from NOMAD_DEPLOYMENT_MODE.
   *
   * @returns 'SAN' for Stand Alone Nomad, 'ACN' for Agency Centric Nomad
   * @default 'SAN'
   */
  getDeploymentMode(): DeploymentMode;

  /**
   * Gets the agency ID from NOMAD_AGENCY_ID.
   *
   * @returns Agency identifier or undefined if not set
   */
  getAgencyId(): string | undefined;

  /**
   * Gets an environment variable value.
   *
   * @param key - Environment variable name
   * @returns Value or undefined if not set
   */
  get(key: string): string | undefined;

  /**
   * Gets a required environment variable value.
   *
   * @param key - Environment variable name
   * @returns Value
   * @throws Error if variable is not set
   */
  getRequired(key: string): string;

  /**
   * Gets an environment variable with a default value.
   *
   * @param key - Environment variable name
   * @param defaultValue - Default if not set
   * @returns Value or default
   */
  getOrDefault(key: string, defaultValue: string): string;

  /**
   * Checks if running in production mode.
   *
   * @returns True if NODE_ENV === 'production'
   */
  isProduction(): boolean;

  /**
   * Checks if running in development mode.
   *
   * @returns True if NODE_ENV === 'development' or not set
   */
  isDevelopment(): boolean;

  /**
   * Checks if running in test mode.
   *
   * @returns True if NODE_ENV === 'test'
   */
  isTest(): boolean;

  /**
   * Gets the current Node environment.
   *
   * @returns NODE_ENV value or 'development' if not set
   */
  getNodeEnv(): string;
}
