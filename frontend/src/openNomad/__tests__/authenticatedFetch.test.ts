/**
 * Tests for adapter fetch() and getBaseUrl() methods
 *
 * Verifies that:
 * - DefaultOpenNomadAPI.fetch() delegates to globalThis.fetch unchanged
 * - DefaultOpenNomadAPI.getBaseUrl() returns empty string
 * - ExampleAgencyAdapter.fetch() merges agency auth headers
 * - ExampleAgencyAdapter.fetch() preserves caller-provided headers
 * - ExampleAgencyAdapter.getBaseUrl() returns configured base URL
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDefaultAdapter } from '../default';
import { createAgencyAdapter } from '../examples/ExampleAgencyAdapter';

// We need to mock services/api because createDefaultAdapter imports it
vi.mock('../../services/api', () => ({
  getModels: vi.fn(),
  getModel: vi.fn(),
  deleteModel: vi.fn(),
  getJob: vi.fn(),
  getConfig: vi.fn(),
}));

describe('DefaultOpenNomadAPI - fetch and getBaseUrl', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Replace globalThis.fetch with a spy
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('fetch()', () => {
    it('calls globalThis.fetch with the provided URL', async () => {
      const api = createDefaultAdapter({ baseUrl: 'http://localhost:3000' });
      const mockResponse = new Response('{}', { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);

      await api.fetch('http://localhost:3000/api/v1/models');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/models',
        undefined
      );
    });

    it('calls globalThis.fetch with the provided URL and init options', async () => {
      const api = createDefaultAdapter({ baseUrl: 'http://localhost:3000' });
      const mockResponse = new Response('{}', { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);

      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' }),
      };

      await api.fetch('http://localhost:3000/api/v1/models', init);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/models',
        init
      );
    });

    it('passes through the response unchanged', async () => {
      const api = createDefaultAdapter({ baseUrl: 'http://localhost:3000' });
      const mockResponse = new Response('{"id":"model-1"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      mockFetch.mockResolvedValue(mockResponse);

      const result = await api.fetch('http://localhost:3000/api/v1/models/model-1');

      expect(result).toBe(mockResponse);
      expect(result.status).toBe(200);
    });
  });

  describe('getBaseUrl()', () => {
    it('returns empty string', () => {
      const api = createDefaultAdapter({ baseUrl: 'http://localhost:3000' });

      expect(api.getBaseUrl()).toBe('');
    });
  });
});

describe('ExampleAgencyAdapter - fetch and getBaseUrl', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('fetch()', () => {
    it('calls globalThis.fetch with merged agency auth headers', async () => {
      const api = createAgencyAdapter({
        authToken: 'my-agency-token',
        apiBaseUrl: 'https://api.agency.gov/nomad',
      });
      const mockResponse = new Response('{}', { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);

      await api.fetch('https://api.agency.gov/nomad/models');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [_url, calledInit] = mockFetch.mock.calls[0];
      expect(calledInit.headers).toMatchObject({
        Authorization: 'Bearer my-agency-token',
        'Content-Type': 'application/json',
      });
    });

    it('preserves caller-provided headers alongside agency headers', async () => {
      const api = createAgencyAdapter({
        authToken: 'my-agency-token',
        apiBaseUrl: 'https://api.agency.gov/nomad',
      });
      const mockResponse = new Response('{}', { status: 200 });
      mockFetch.mockResolvedValue(mockResponse);

      const callerInit: RequestInit = {
        method: 'POST',
        headers: {
          'X-Custom-Header': 'custom-value',
        },
      };

      await api.fetch('https://api.agency.gov/nomad/models', callerInit);

      const [_url, calledInit] = mockFetch.mock.calls[0];
      // Agency auth headers must be present
      expect(calledInit.headers).toMatchObject({
        Authorization: 'Bearer my-agency-token',
        'Content-Type': 'application/json',
      });
      // Caller headers must also be present
      expect(calledInit.headers).toMatchObject({
        'X-Custom-Header': 'custom-value',
      });
    });

    it('passes through the response unchanged', async () => {
      const api = createAgencyAdapter({
        authToken: 'my-agency-token',
        apiBaseUrl: 'https://api.agency.gov/nomad',
      });
      const mockResponse = new Response('{"id":"model-1"}', { status: 201 });
      mockFetch.mockResolvedValue(mockResponse);

      const result = await api.fetch('https://api.agency.gov/nomad/models');

      expect(result).toBe(mockResponse);
      expect(result.status).toBe(201);
    });
  });

  describe('getBaseUrl()', () => {
    it('returns the configured apiBaseUrl', () => {
      const api = createAgencyAdapter({
        authToken: 'token',
        apiBaseUrl: 'https://api.agency.gov/nomad',
      });

      expect(api.getBaseUrl()).toBe('https://api.agency.gov/nomad');
    });

    it('returns the default apiBaseUrl when not configured', () => {
      const api = createAgencyAdapter({
        authToken: 'token',
        // apiBaseUrl defaults to '/api/nomad'
      });

      expect(api.getBaseUrl()).toBe('/api/nomad');
    });
  });
});
