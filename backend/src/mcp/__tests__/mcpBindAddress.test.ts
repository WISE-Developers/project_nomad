import { describe, it, expect } from 'vitest';
import { resolveMcpBindAddress } from '../listener.js';

/**
 * WHY THIS EXISTS, measured on the CIFFC demo 2026-11-13 at v0.59.0.
 *
 * MCP bound container loopback and compose published 127.0.0.1:3002 on the HOST.
 * Docker forwards a published port to the container's BRIDGE address, not to the
 * container's loopback, so the publish was inert:
 *
 *   172.18.0.2:3002  CLOSED   (MCP, bound to container loopback)
 *   172.18.0.2:3001  OPEN     (the app, bound to all interfaces) <- positive control
 *   docker port nomad -> 3002/tcp -> 127.0.0.1:3002
 *
 * docker-proxy therefore accepted the tunnel's bytes and closed: 491 bytes written,
 * 0 read. Publishing the port is necessary and NOT sufficient -- inside the container
 * the listener has to bind an address the bridge can reach.
 *
 * The boundary does not move. It rests where it always did: the HOST publish is
 * pinned to literal 127.0.0.1 (scripts/__tests__/mcp_port_loopback_only.test.sh),
 * so the edge has no route, and the key is still required.
 */
describe('resolveMcpBindAddress', () => {
  it('defaults to loopback when nothing is configured', () => {
    expect(resolveMcpBindAddress({})).toBe('127.0.0.1');
  });

  it('allows 0.0.0.0 so a published port can reach it inside a container', () => {
    expect(resolveMcpBindAddress({ NOMAD_MCP_BIND_ADDRESS: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('allows loopback to be set explicitly', () => {
    expect(resolveMcpBindAddress({ NOMAD_MCP_BIND_ADDRESS: '127.0.0.1' })).toBe('127.0.0.1');
  });

  it('trims surrounding whitespace rather than failing on it', () => {
    expect(resolveMcpBindAddress({ NOMAD_MCP_BIND_ADDRESS: '  0.0.0.0  ' })).toBe('0.0.0.0');
  });

  it('treats an empty value as unset rather than as a bind to everything', () => {
    expect(resolveMcpBindAddress({ NOMAD_MCP_BIND_ADDRESS: '   ' })).toBe('127.0.0.1');
  });

  it('refuses any other address instead of silently accepting it', () => {
    expect(() => resolveMcpBindAddress({ NOMAD_MCP_BIND_ADDRESS: '0.0.0.0 ' + '# publish me' }))
      .toThrow(/NOMAD_MCP_BIND_ADDRESS/);
    expect(() => resolveMcpBindAddress({ NOMAD_MCP_BIND_ADDRESS: '::' })).toThrow(/NOMAD_MCP_BIND_ADDRESS/);
    expect(() => resolveMcpBindAddress({ NOMAD_MCP_BIND_ADDRESS: '192.168.1.10' })).toThrow(
      /NOMAD_MCP_BIND_ADDRESS/,
    );
  });
});
