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

  /**
   * The value a fuel coverage uses to mark an ABSENT pixel (#282). REQUIRED — there is
   * deliberately no default and no seeded placeholder.
   *
   * The CFS WCS declares none of its own: `swe:nilValues` is empty and the GeoTIFF
   * carries no NoData tag (measured 2026-11-04). Until somebody declares one, an absent
   * pixel and a fuel class we failed to decode are the same byte, and treating either as
   * the other asserts a fire-behaviour fact about a pixel we cannot read.
   *
   * A seeded placeholder would be worse than nothing: the fuel path would run against a
   * nil value nobody chose, succeeding quietly on the wrong pixels. Crash instead, and
   * let an operator put the real value in `.env` when the publisher declares it — which
   * is the whole point of it being configuration rather than a constant.
   *
   * NOT `getRequired`: that rejects any falsy string, and "0" is the value this key is
   * most likely to hold — it is what the live coverage uses past its data edge.
   *
   * @returns the declared nil value as an integer, which MAY be 0 or negative
   * @throws Error if unset, empty, or not an integer
   */
  getFuelNoDataValue(): number {
    const KEY = 'NOMAD_FUEL_NODATA_VALUE';
    const raw = process.env[KEY];

    if (raw === undefined || raw.trim() === '') {
      throw new Error(
        `Required environment variable "${KEY}" is not set. The fuel coverage declares ` +
          'no nil value of its own, so Nomad cannot tell an absent pixel from a fuel ' +
          'class it failed to decode. Set it to the value the publisher uses for absent ' +
          'pixels. There is deliberately no default.'
      );
    }

    const trimmed = raw.trim();
    // Number('') is 0 and Number(' ') is 0, which is why the blank check is above this.
    const value = Number(trimmed);
    if (!Number.isInteger(value)) {
      throw new Error(
        `Invalid ${KEY}: "${trimmed}" is not an integer. A fuel grid pixel is a ` +
          'classified grid_value, so a fractional or non-numeric nil value could never ' +
          'match one, and the setting would silently do nothing.'
      );
    }

    return value;
  }
}
