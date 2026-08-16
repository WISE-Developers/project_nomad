import { describe, it, expect, beforeEach } from 'vitest';
import { SessionUsageTracker } from '../sessionTracker.js';

/**
 * Session login/logout tracking (#332).
 *
 * Better Auth owns sign-in and sign-out entirely, and its database hooks hand
 * back a session carrying only a userId. Keying login events on that id while
 * run events are keyed on email would give two different keys for the same
 * person, so logins are instead observed where the email is already in hand:
 * the session middleware.
 *
 * That means the tracker sees REQUESTS, not sign-ins. It infers a login from
 * the first sighting of a session, and says so in the event - after a restart
 * every active user is sighted afresh, and an inferred login must never be
 * counted as a clean sign-in.
 */
describe('SessionUsageTracker', () => {
  let tracker: SessionUsageTracker;

  beforeEach(() => {
    tracker = new SessionUsageTracker();
  });

  describe('login', () => {
    it('reports a login the first time a session is seen', () => {
      expect(tracker.noteSeen('sess-1', 'franco@example.ca')).toEqual({
        isNew: true,
        actor: 'franco@example.ca',
      });
    });

    it('does not report a login on subsequent requests of the same session', () => {
      tracker.noteSeen('sess-1', 'franco@example.ca');
      expect(tracker.noteSeen('sess-1', 'franco@example.ca').isNew).toBe(false);
      expect(tracker.noteSeen('sess-1', 'franco@example.ca').isNew).toBe(false);
    });

    it('tracks distinct sessions independently', () => {
      expect(tracker.noteSeen('sess-1', 'franco@example.ca').isNew).toBe(true);
      expect(tracker.noteSeen('sess-2', 'heidi@example.ca').isNew).toBe(true);
      expect(tracker.noteSeen('sess-1', 'franco@example.ca').isNew).toBe(false);
    });

    it('treats the same person on a second device as a separate session', () => {
      tracker.noteSeen('sess-1', 'franco@example.ca');
      expect(tracker.noteSeen('sess-2', 'franco@example.ca').isNew).toBe(true);
    });
  });

  describe('logout', () => {
    it('resolves the email for a session it has seen', () => {
      tracker.noteSeen('sess-1', 'franco@example.ca');
      expect(tracker.noteEnded('sess-1')).toBe('franco@example.ca');
    });

    it('forgets the session after it ends, so a re-login counts again', () => {
      tracker.noteSeen('sess-1', 'franco@example.ca');
      tracker.noteEnded('sess-1');
      expect(tracker.noteSeen('sess-1', 'franco@example.ca').isNew).toBe(true);
    });

    it('returns null for a session it never saw — never invents an actor', () => {
      // Happens after a restart: the session exists, our memory of it does not.
      expect(tracker.noteEnded('sess-unknown')).toBeNull();
    });
  });

  describe('bounded memory', () => {
    it('does not grow without limit on a long-running server', () => {
      const small = new SessionUsageTracker({ maxSessions: 10 });
      for (let i = 0; i < 100; i++) {
        small.noteSeen(`sess-${i}`, `user${i}@example.ca`);
      }
      expect(small.size).toBeLessThanOrEqual(10);
    });

    it('evicts the oldest sessions first, keeping the most recent', () => {
      const small = new SessionUsageTracker({ maxSessions: 3 });
      small.noteSeen('a', 'a@example.ca');
      small.noteSeen('b', 'b@example.ca');
      small.noteSeen('c', 'c@example.ca');
      small.noteSeen('d', 'd@example.ca');

      expect(small.noteEnded('a')).toBeNull();
      expect(small.noteEnded('d')).toBe('d@example.ca');
    });
  });
});
