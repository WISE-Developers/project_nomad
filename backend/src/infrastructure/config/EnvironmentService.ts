import { IEnvironmentService, DeploymentMode } from '../../application/interfaces/index.js';

/**
 * Implementation of IEnvironmentService that reads from process.env.
 *
 * Provides validated access to environment variables with sensible defaults.
 */
export class EnvironmentService implements IEnvironmentService {
  private static instance: EnvironmentService | null = null;

  /**
   * Gets the singleton instance of EnvironmentService.
   */
  static getInstance(): EnvironmentService {
    if (!EnvironmentService.instance) {
      EnvironmentService.instance = new EnvironmentService();
    }
    return EnvironmentService.instance;
  }

  /**
   * Resets the singleton instance (for testing).
   */
  static resetInstance(): void {
    EnvironmentService.instance = null;
  }

  getDeploymentMode(): DeploymentMode {
    const mode = process.env.NOMAD_DEPLOYMENT_MODE?.toUpperCase();

    if (!mode) {
      return 'SAN';
    }

    if (mode !== 'SAN' && mode !== 'ACN') {
      throw new Error(
        `Invalid NOMAD_DEPLOYMENT_MODE: "${mode}". Must be "SAN" or "ACN".`
      );
    }

    return mode;
  }

  getAgencyId(): string | undefined {
    return process.env.NOMAD_AGENCY_ID || undefined;
  }

  get(key: string): string | undefined {
    return process.env[key] || undefined;
  }

  getRequired(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Required environment variable "${key}" is not set.`);
    }
    return value;
  }

  getOrDefault(key: string, defaultValue: string): string {
    return process.env[key] || defaultValue;
  }

  isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  isDevelopment(): boolean {
    return !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
  }

  isTest(): boolean {
    return process.env.NODE_ENV === 'test';
  }

  getNodeEnv(): string {
    return process.env.NODE_ENV || 'development';
  }
}
