import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import type {
  AuthMode,
  UsageEvent,
  UsageEventDetail,
  UsageEventType,
} from '../../domain/value-objects/UsageEvent.js';

/** Inputs for building one usage event. */
export interface CreateUsageEventInput {
  type: UsageEventType;
  actor: string;
  /** IANA zone from NOMAD_HOME_TIMEZONE. */
  zone: string;
  /** The instant to stamp. Injected so events are testable and deterministic. */
  now: Date;
  modelId?: string;
  detail?: UsageEventDetail;
}

/**
 * Builds an immutable usage event, stamping both timestamps from one instant.
 *
 * `now` is passed in rather than read here: an event's time is a fact about
 * when the thing happened, not about when this function ran.
 *
 * @throws Error if `zone` is not a valid IANA zone - stamping UTC instead
 *         would produce a log that looks healthy and reads six hours wrong.
 */
export function createUsageEvent(input: CreateUsageEventInput): UsageEvent {
  const utc = DateTime.fromJSDate(input.now, { zone: 'utc' });
  const local = utc.setZone(input.zone);

  if (!local.isValid) {
    throw new Error(
      `Cannot stamp usage event: "${input.zone}" is not a valid IANA time zone ` +
        `(${local.invalidReason ?? 'unknown reason'}).`
    );
  }

  // Common fields are assigned AFTER detail so a caller-supplied payload can
  // never forge an event's identity or timestamps.
  return Object.freeze({
    id: randomUUID(),
    type: input.type,
    ts_utc: utc.toISO({ suppressMilliseconds: false }) as string,
    ts_local: local.toISO({ suppressMilliseconds: false }) as string,
    actor: input.actor,
    ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  });
}

/** Whatever identity signal is available on the current request. */
export interface ResolveActorInput {
  authMode: AuthMode;
  /** simple mode: the raw x-nomad-user header, if present. */
  header?: string;
  /** oauth mode: the session email. Emails are assumed unique across users. */
  email?: string;
  /** oauth mode: the display name. Deliberately NOT used as identity. */
  name?: string;
  /** acn mode: X-Nomad-User-Id from the agency IdP. */
  userId?: string;
}

/** Actor used when a mode's identity signal is present but empty. */
export const UNKNOWN_USER = 'Unknown User';
/** Actor used for oauth events that have no session at all, e.g. failed login. */
export const UNAUTHENTICATED_USER = 'Unauthenticated User';
/** Actor used in none mode, which assumes a single user per instance. */
export const SINGLE_USER = 'User';
/** Actor used for system events such as app.started. */
export const SYSTEM_ACTOR = 'System';

/**
 * Resolves the actor string for an event. Nomad has no user id of its own, and
 * each auth mode carries a different identity signal - so every mode is mapped
 * explicitly here. Always returns a non-empty string.
 */
export function resolveActor(input: ResolveActorInput): string {
  switch (input.authMode) {
    case 'none':
      // No identity exists in this mode; a single user is assumed.
      return SINGLE_USER;

    case 'simple': {
      // The x-nomad-user header is what distinguishes users on this instance.
      // It is optional and unenforced, so absent and blank both fall through.
      const header = input.header?.trim();
      return header ? header : UNKNOWN_USER;
    }

    case 'oauth': {
      // Email, never display name: betterAuthSession sets req.user to
      // `name || email`, but name is mutable and not unique.
      const email = input.email?.trim();
      return email ? email : UNAUTHENTICATED_USER;
    }

    case 'acn': {
      // acnAuth rejects requests without this header, so it is always present.
      const userId = input.userId?.trim();
      return userId ? userId : UNKNOWN_USER;
    }
  }
}
