/**
 * Startup refuses Docker mode without COMPOSE_PROJECT_NAME, and says why
 * (verification/job-lifecycle, ComposeProject.tla: UnsetNeverServes).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { requireComposeProjectName } from '../composeProjectName.js';

describe('requireComposeProjectName', () => {
  it('returns the name in Docker mode', () => {
    expect(requireComposeProjectName({ COMPOSE_PROJECT_NAME: 'nomad_prod' })).toBe('nomad_prod');
  });

  it('throws in Docker mode when it is unset, naming the key and what to do', () => {
    expect(() => requireComposeProjectName({})).toThrow(/COMPOSE_PROJECT_NAME is not set.*docker compose ls/s);
  });

  it('throws when it is blank', () => {
    expect(() => requireComposeProjectName({ COMPOSE_PROJECT_NAME: '  ' })).toThrow(/COMPOSE_PROJECT_NAME/);
  });

  it('is Docker mode when FIRESTARR_EXECUTION_MODE is unset', () => {
    expect(() => requireComposeProjectName({ FIRESTARR_EXECUTION_MODE: undefined })).toThrow(/COMPOSE_PROJECT_NAME/);
  });

  it('does not need it in binary mode, which starts no containers', () => {
    expect(requireComposeProjectName({ FIRESTARR_EXECUTION_MODE: 'binary' })).toBeUndefined();
  });
});

describe('the server checks it at boot', () => {
  const index = readFileSync(join(__dirname, '..', '..', '..', 'index.ts'), 'utf8');
  const start = index.indexOf('async function startServer');

  it('inside startServer, whose catch logs the reason and exits 1', () => {
    expect(start).toBeGreaterThan(-1);
    expect(index.indexOf('requireComposeProjectName(process.env)', start)).toBeGreaterThan(start);
  });

  it('before anything touches the database or Docker', () => {
    expect(index.indexOf('requireComposeProjectName(process.env)', start)).toBeLessThan(
      index.indexOf('await initializeDatabaseLayer()', start),
    );
  });
});
