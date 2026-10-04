/**
 * Vitest Test Setup
 *
 * This file runs before all tests to set up the testing environment.
 *
 * @module test/setup
 */

import '@testing-library/jest-dom';
import { vi } from 'vitest';

/**
 * setupFiles runs for EVERY test file, including ones that declare
 * `@vitest-environment node` — and a node environment has no `window`, so the
 * DOM stubs below would throw before any test in such a file could run.
 *
 * Guarded rather than split into two setup files: the DOM mocks are only
 * meaningful where a DOM exists, and a node-environment test wants none of them.
 */
const hasDom = typeof window !== 'undefined';

// Mock window.matchMedia (used by some UI components)
if (hasDom) Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver (used by react-rnd)
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock URL.createObjectURL (required by maplibre-gl in jsdom)
if (hasDom && typeof window.URL.createObjectURL === 'undefined') {
  window.URL.createObjectURL = vi.fn(() => 'blob:mock');
  window.URL.revokeObjectURL = vi.fn();
}
