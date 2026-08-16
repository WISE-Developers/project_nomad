import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvironmentService } from '../EnvironmentService.js';

/**
 * NOMAD_HOME_TIMEZONE is the IANA zone used to stamp ts_local in the usage log (#332).
 *
 * It is REQUIRED and fail-fast by design. The container's default TZ is UTC
 * (verified in node:22-slim), so any default or fallback would make ts_local
 * byte-identical to ts_utc — a log that passes every health check while being
 * six hours wrong. That is the same silent-substitution failure as #319/#327.
 */
describe('EnvironmentService.getHomeTimezone', () => {
  const original = process.env.NOMAD_HOME_TIMEZONE;

  beforeEach(() => {
    EnvironmentService.resetInstance();
    delete process.env.NOMAD_HOME_TIMEZONE;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.NOMAD_HOME_TIMEZONE;
    } else {
      process.env.NOMAD_HOME_TIMEZONE = original;
    }
    EnvironmentService.resetInstance();
  });

  it('throws when NOMAD_HOME_TIMEZONE is not set — no default, ever', () => {
    expect(() => EnvironmentService.getInstance().getHomeTimezone()).toThrow(
      /NOMAD_HOME_TIMEZONE/
    );
  });

  it('does not fall back to UTC when unset', () => {
    let result: string | undefined;
    try {
      result = EnvironmentService.getInstance().getHomeTimezone();
    } catch {
      result = undefined;
    }
    expect(result).toBeUndefined();
  });

  it('throws when the zone is not a valid IANA zone name', () => {
    process.env.NOMAD_HOME_TIMEZONE = 'America/Yellowknive';
    expect(() => EnvironmentService.getInstance().getHomeTimezone()).toThrow(
      /America\/Yellowknive/
    );
  });

  it('throws on a plain offset rather than an IANA name', () => {
    // "-06:00" cannot observe DST — accepting it would silently freeze the
    // deployment on the summer offset all winter.
    process.env.NOMAD_HOME_TIMEZONE = '-06:00';
    expect(() => EnvironmentService.getInstance().getHomeTimezone()).toThrow();
  });

  it('throws on an empty or whitespace-only value', () => {
    process.env.NOMAD_HOME_TIMEZONE = '   ';
    expect(() => EnvironmentService.getInstance().getHomeTimezone()).toThrow();
  });

  it('returns a valid IANA zone name', () => {
    process.env.NOMAD_HOME_TIMEZONE = 'America/Edmonton';
    expect(EnvironmentService.getInstance().getHomeTimezone()).toBe('America/Edmonton');
  });

  it('accepts a zone other than Mountain — the zone is per deployment', () => {
    process.env.NOMAD_HOME_TIMEZONE = 'America/Toronto';
    expect(EnvironmentService.getInstance().getHomeTimezone()).toBe('America/Toronto');
  });

  it('trims surrounding whitespace from an otherwise valid zone', () => {
    process.env.NOMAD_HOME_TIMEZONE = '  America/Edmonton  ';
    expect(EnvironmentService.getInstance().getHomeTimezone()).toBe('America/Edmonton');
  });

  it('accepts UTC when a deployment genuinely wants it — explicit, not defaulted', () => {
    process.env.NOMAD_HOME_TIMEZONE = 'UTC';
    expect(EnvironmentService.getInstance().getHomeTimezone()).toBe('UTC');
  });
});
