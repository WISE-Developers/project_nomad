/**
 * Convention test — #507's gate must be MOUNTED, and mounted before the router.
 *
 * Why this exists separately from the middleware's own tests: a middleware can
 * be perfectly correct and simply not wired in. Deleting the `app.use(...)`
 * line in `index.ts` breaks nothing that any other test can see — the unit
 * tests still pass, because they call the function directly. The hole reopens
 * silently.
 *
 * That is the same shape as a guard proved only by its own existence. This
 * test reads the composition, not the component.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const indexPath = join(__dirname, '..', '..', '..', 'index.ts');

describe('convention: #507 gate is wired into the app', () => {
  it('reads index.ts and finds the API router mount (control for the reader)', () => {
    // Without this, a wrong path or a renamed file would make the assertions
    // below vacuously true.
    const source = readFileSync(indexPath, 'utf-8');
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("app.use('/api', apiRouter)");
  });

  it('mounts requireIdentityOnWrites', () => {
    const source = readFileSync(indexPath, 'utf-8');
    expect(source).toContain("app.use('/api', requireIdentityOnWrites)");
  });

  it('mounts it BEFORE the API router, or it gates nothing', () => {
    const source = readFileSync(indexPath, 'utf-8');

    const gate = source.indexOf("app.use('/api', requireIdentityOnWrites)");
    const router = source.indexOf("app.use('/api', apiRouter)");

    expect(gate).toBeGreaterThan(-1);
    expect(router).toBeGreaterThan(-1);
    // Express runs middleware in mount order. Mounted after the router, the
    // gate would be reached only for requests no route handled — which is to
    // say, never for the routes it is supposed to protect.
    expect(gate).toBeLessThan(router);
  });

  it('mounts it AFTER the mode-specific auth, which is what populates the identity', () => {
    const source = readFileSync(indexPath, 'utf-8');

    const simpleAuth = source.indexOf('app.use(simpleAuthMiddleware)');
    const gate = source.indexOf("app.use('/api', requireIdentityOnWrites)");

    expect(simpleAuth).toBeGreaterThan(-1);
    // Mounted first, the gate would read an identity nothing had resolved yet
    // and refuse every write in simple mode — failing closed, but for the wrong
    // reason and with a misleading message.
    expect(gate).toBeGreaterThan(simpleAuth);
  });
});
