/** Result of sighting a session on a request. */
export interface SessionSighting {
  /** True the first time this session is seen - treated as a login. */
  isNew: boolean;
  /** The email this session belongs to. */
  actor: string;
}

export interface SessionUsageTrackerOptions {
  /**
   * Upper bound on remembered sessions. This map lives for the life of the
   * process, so it needs a ceiling: a long-running server with many users
   * would otherwise grow it without limit.
   */
  maxSessions?: number;
}

const DEFAULT_MAX_SESSIONS = 5000;

/**
 * Remembers which sessions have been seen, so a login can be reported once
 * rather than on every request (#332).
 *
 * This observes REQUESTS, not sign-ins. Better Auth owns the sign-in flow and
 * its database hooks expose only a userId, while every other event in the log
 * is keyed on email - so logins are inferred here, where the email is already
 * resolved, and the inference is declared in the event.
 *
 * The memory is deliberately process-local and therefore lost on restart: after
 * a reboot every active user is sighted afresh and reported as a new login.
 * Callers must mark those events as inferred so nobody reads them as a clean
 * sign-in count.
 */
export class SessionUsageTracker {
  private readonly maxSessions: number;

  /** sessionId -> email. Insertion-ordered, which gives oldest-first eviction. */
  private readonly seen = new Map<string, string>();

  constructor(options: SessionUsageTrackerOptions = {}) {
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  }

  get size(): number {
    return this.seen.size;
  }

  /**
   * Records a sighting of a session on a request.
   *
   * @returns isNew=true the first time, which the caller treats as a login.
   */
  noteSeen(sessionId: string, email: string): SessionSighting {
    if (this.seen.has(sessionId)) {
      return { isNew: false, actor: this.seen.get(sessionId) as string };
    }

    this.seen.set(sessionId, email);

    // Evict oldest first. Map iteration order is insertion order, so the first
    // key is the least recently added.
    while (this.seen.size > this.maxSessions) {
      const oldest = this.seen.keys().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }

    return { isNew: true, actor: email };
  }

  /**
   * Marks a session as ended and resolves who it belonged to.
   *
   * @returns the email, or null if this session was never seen - which happens
   *          after a restart. Null rather than a placeholder: the caller decides
   *          how to describe an unknown actor, and this must never invent one.
   */
  noteEnded(sessionId: string): string | null {
    const email = this.seen.get(sessionId);
    if (email === undefined) return null;
    this.seen.delete(sessionId);
    return email;
  }
}
