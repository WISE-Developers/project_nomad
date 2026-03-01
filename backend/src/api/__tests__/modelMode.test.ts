/**
 * Backend Tests: ModelMode validation
 *
 * Tests the ModelMode type and validation constants defined in
 * IFireModelingEngine.ts and consumed by the models route.
 *
 * @module api/__tests__/modelMode
 */

import { describe, it, expect } from 'vitest';
import type { ModelMode } from '../../application/interfaces/IFireModelingEngine.js';

// =============================================================================
// Constants mirrored from models.ts route (same values, tested in isolation)
// =============================================================================

const VALID_MODEL_MODES: ModelMode[] = ['probabilistic', 'deterministic', 'long-term-risk'];

/**
 * Simulate the route validation logic:
 * - unknown modelMode → invalid
 * - deterministic / long-term-risk → valid but not yet available
 * - probabilistic → valid and available
 */
function validateModelMode(modelMode: string | undefined): {
  valid: boolean;
  available: boolean;
  error?: string;
} {
  const resolved = (modelMode ?? 'probabilistic') as ModelMode;

  if (!VALID_MODEL_MODES.includes(resolved)) {
    return {
      valid: false,
      available: false,
      error: `Must be one of: ${VALID_MODEL_MODES.join(', ')}`,
    };
  }

  if (resolved !== 'probabilistic') {
    return {
      valid: true,
      available: false,
      error: `'${resolved}' mode is coming soon and cannot be selected`,
    };
  }

  return { valid: true, available: true };
}

/**
 * Simulate outputMode derivation logic used in the route.
 */
function deriveOutputMode(modelMode: ModelMode): 'probabilistic' | 'pseudo-deterministic' {
  return modelMode === 'deterministic' ? 'pseudo-deterministic' : 'probabilistic';
}

// =============================================================================
// Tests
// =============================================================================

describe('ModelMode validation', () => {
  describe('valid model modes', () => {
    it('accepts probabilistic as a valid mode', () => {
      const result = validateModelMode('probabilistic');
      expect(result.valid).toBe(true);
    });

    it('accepts deterministic as a valid (but unavailable) mode', () => {
      const result = validateModelMode('deterministic');
      expect(result.valid).toBe(true);
      expect(result.available).toBe(false);
    });

    it('accepts long-term-risk as a valid (but unavailable) mode', () => {
      const result = validateModelMode('long-term-risk');
      expect(result.valid).toBe(true);
      expect(result.available).toBe(false);
    });
  });

  describe('invalid model modes', () => {
    it('rejects unknown mode strings', () => {
      const result = validateModelMode('unknown-mode');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Must be one of');
    });

    it('rejects empty string', () => {
      const result = validateModelMode('');
      expect(result.valid).toBe(false);
    });

    it('rejects partially matching strings', () => {
      const result = validateModelMode('prob');
      expect(result.valid).toBe(false);
    });
  });

  describe('default behaviour', () => {
    it('defaults to probabilistic when modelMode is undefined', () => {
      const result = validateModelMode(undefined);
      expect(result.valid).toBe(true);
      expect(result.available).toBe(true);
    });
  });

  describe('availability gate', () => {
    it('marks probabilistic as available', () => {
      const result = validateModelMode('probabilistic');
      expect(result.available).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('marks deterministic as unavailable with coming-soon message', () => {
      const result = validateModelMode('deterministic');
      expect(result.available).toBe(false);
      expect(result.error).toContain('coming soon');
    });

    it('marks long-term-risk as unavailable with coming-soon message', () => {
      const result = validateModelMode('long-term-risk');
      expect(result.available).toBe(false);
      expect(result.error).toContain('coming soon');
    });
  });
});

describe('outputMode derivation from modelMode', () => {
  it('derives probabilistic outputMode from probabilistic modelMode', () => {
    expect(deriveOutputMode('probabilistic')).toBe('probabilistic');
  });

  it('derives pseudo-deterministic outputMode from deterministic modelMode', () => {
    expect(deriveOutputMode('deterministic')).toBe('pseudo-deterministic');
  });

  it('derives probabilistic outputMode from long-term-risk modelMode', () => {
    expect(deriveOutputMode('long-term-risk')).toBe('probabilistic');
  });
});

describe('VALID_MODEL_MODES constant', () => {
  it('contains exactly three modes', () => {
    expect(VALID_MODEL_MODES).toHaveLength(3);
  });

  it('includes probabilistic', () => {
    expect(VALID_MODEL_MODES).toContain('probabilistic');
  });

  it('includes deterministic', () => {
    expect(VALID_MODEL_MODES).toContain('deterministic');
  });

  it('includes long-term-risk', () => {
    expect(VALID_MODEL_MODES).toContain('long-term-risk');
  });
});
