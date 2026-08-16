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

  /**
   * Gets and validates the FireSTARR execution mode.
   *
   * @returns 'docker' or 'binary'
   * @throws Error if binary mode is set without FIRESTARR_BINARY_PATH
   */
  getFireSTARRExecutionMode(): 'docker' | 'binary' {
    const mode = this.get('FIRESTARR_EXECUTION_MODE')?.toLowerCase() || 'docker';

    if (mode === 'binary') {
      const binaryPath = this.get('FIRESTARR_BINARY_PATH');
      if (!binaryPath) {
        throw new Error(
          'FIRESTARR_EXECUTION_MODE=binary requires FIRESTARR_BINARY_PATH to be set'
        );
      }
    }

    if (mode !== 'docker' && mode !== 'binary') {
      throw new Error(
        `Invalid FIRESTARR_EXECUTION_MODE: "${mode}". Must be "docker" or "binary".`
      );
    }

    return mode;
  }

  /**
   * Gets the FireSTARR binary path.
   * Required when FIRESTARR_EXECUTION_MODE=binary.
   */
  getFireSTARRBinaryPath(): string | undefined {
    return this.get('FIRESTARR_BINARY_PATH');
  }

  /**
   * Gets and validates the deployment's home IANA time zone.
   *
   * Used to stamp ts_local in the usage log (#332). REQUIRED — there is
   * deliberately no default and no fallback.
   *
   * The production container (node:22-slim) defaults to TZ=UTC, so any fallback
   * would make ts_local byte-identical to ts_utc: a log that passes every health
   * check while being six hours wrong. Crash instead.
   *
   * @returns a valid IANA zone name, e.g. 'America/Edmonton'
   * @throws Error if unset, empty, a fixed offset, or not a real IANA zone
   */
  getHomeTimezone(): string {
    const zone = this.getRequired('NOMAD_HOME_TIMEZONE').trim();

    if (!zone) {
      throw new Error(
        'Required environment variable "NOMAD_HOME_TIMEZONE" is empty.'
      );
    }

    // A fixed offset cannot observe DST. Accepting "-06:00" would freeze the
    // deployment on the summer offset all winter, which is precisely the class
    // of quietly-wrong clock this variable exists to prevent.
    if (/^[+-]/.test(zone)) {
      throw new Error(
        `Invalid NOMAD_HOME_TIMEZONE: "${zone}" is a fixed UTC offset, not an ` +
          'IANA time zone name. A fixed offset cannot observe DST. ' +
          'Use a zone name such as "America/Edmonton".'
      );
    }

    // Constructing a formatter IS the validation: ICU throws RangeError on an
    // unknown zone. Verified full-ICU in node:22-slim, so no lookup table and
    // no tzdata package is needed.
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    } catch {
      throw new Error(
        `Invalid NOMAD_HOME_TIMEZONE: "${zone}" is not a valid IANA time zone ` +
          'name. Use a zone name such as "America/Edmonton".'
      );
    }

    return zone;
  }
}
