/**
 * Tests for ModelSetup date helpers.
 *
 * The wizard's "today/yesterday/fire-season" date defaults must reflect the
 * user's LOCAL calendar day, not UTC. Helpers accept an optional IANA
 * timezone so tests stay deterministic regardless of the test-runner zone.
 *
 * Refs #273 (TZ double-adjust root cause).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getTodayDate,
  getYesterdayDate,
  getFireSeasonStartDate,
} from '../dateHelpers.js';

describe('dateHelpers — local-calendar dates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getTodayDate', () => {
    it('returns 2026-06-01 in America/Vancouver when wall clock is 18:00 PDT', () => {
      // 2026-06-02T01:00:00Z == 2026-06-01 18:00 PDT (UTC-7)
      vi.setSystemTime(new Date('2026-06-02T01:00:00Z'));
      expect(getTodayDate('America/Vancouver')).toBe('2026-06-01');
    });

    it('returns 2026-06-01 in America/Toronto when wall clock is 21:00 EDT', () => {
      vi.setSystemTime(new Date('2026-06-02T01:00:00Z'));
      expect(getTodayDate('America/Toronto')).toBe('2026-06-01');
    });

    it('returns 2026-06-02 in UTC at the same instant (boundary check)', () => {
      vi.setSystemTime(new Date('2026-06-02T01:00:00Z'));
      expect(getTodayDate('UTC')).toBe('2026-06-02');
    });
  });

  describe('getYesterdayDate', () => {
    it('returns 2026-05-31 in America/Vancouver when today is 2026-06-01 local', () => {
      vi.setSystemTime(new Date('2026-06-02T01:00:00Z'));
      expect(getYesterdayDate('America/Vancouver')).toBe('2026-05-31');
    });

    it('crosses month boundaries correctly', () => {
      vi.setSystemTime(new Date('2026-06-01T15:00:00Z')); // 08:00 PDT June 1
      expect(getYesterdayDate('America/Vancouver')).toBe('2026-05-31');
    });
  });

  describe('getFireSeasonStartDate', () => {
    it('returns April 1 of the current year in America/Vancouver', () => {
      vi.setSystemTime(new Date('2026-06-02T01:00:00Z'));
      expect(getFireSeasonStartDate('America/Vancouver')).toBe('2026-04-01');
    });

    it('uses the local-year, not UTC-year, near a new-year boundary', () => {
      // 2026-01-01T03:00:00Z == 2025-12-31 19:00 PST (still 2025 locally)
      vi.setSystemTime(new Date('2026-01-01T03:00:00Z'));
      expect(getFireSeasonStartDate('America/Vancouver')).toBe('2025-04-01');
    });
  });
});
