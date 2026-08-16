import type { IUsageLogger } from '../interfaces/IUsageLogger.js';
import type { AuthMode } from '../../domain/value-objects/UsageEvent.js';
import { createUsageEvent, SYSTEM_ACTOR } from './usageEvent.js';

/** Auth modes as the rest of the app knows them. ACN is a separate axis. */
type AppAuthMode = 'none' | 'simple' | 'oauth';
type DeploymentMode = 'SAN' | 'ACN';

export interface ResolveUsageAuthModeInput {
  deploymentMode: DeploymentMode;
  authMode: AppAuthMode;
}

/**
 * Maps Nomad's two orthogonal axes onto the single auth mode the usage log
 * records.
 *
 * NOMAD_AUTH_MODE is none|simple|oauth, but an ACN deployment carries identity
 * through agency gateway headers regardless of what that variable says. For the
 * purpose of reading the log, "how was the actor identified" is the question -
 * so ACN wins.
 */
export function resolveUsageAuthMode(input: ResolveUsageAuthModeInput): AuthMode {
  return input.deploymentMode === 'ACN' ? 'acn' : input.authMode;
}

export interface RecordAppStartedInput {
  usageLogger: IUsageLogger;
  /** Validated IANA zone from NOMAD_HOME_TIMEZONE. */
  zone: string;
  deploymentMode: DeploymentMode;
  authMode: AppAuthMode;
  version: string;
  now: Date;
}

/**
 * Emits the app.started segment header.
 *
 * Must be called unconditionally at every boot. The auth_mode it records is
 * authoritative for every event until the next app.started, so a missing header
 * makes the whole following segment uninterpretable.
 *
 * @throws Error if the zone is invalid. A bad zone means every timestamp in the
 *         segment would be wrong, and a confidently-wrong log is worse than no
 *         log. Failures of the LOGGER itself are swallowed - boot does not
 *         depend on the log being writable.
 */
export async function recordAppStarted(input: RecordAppStartedInput): Promise<void> {
  // Built before recording so an invalid zone throws without emitting anything.
  const event = createUsageEvent({
    type: 'app.started',
    actor: SYSTEM_ACTOR,
    zone: input.zone,
    now: input.now,
    detail: {
      auth_mode: resolveUsageAuthMode({
        deploymentMode: input.deploymentMode,
        authMode: input.authMode,
      }),
      deployment_mode: input.deploymentMode,
      nomad_version: input.version,
    },
  });

  // record() is contractually non-throwing, but a fake or a future adapter
  // could break that. Boot must survive it either way.
  await Promise.resolve(input.usageLogger.record(event)).catch(() => undefined);
}
