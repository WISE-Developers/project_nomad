/**
 * Convention test — DrawingToolbar must only render inside the model wizard.
 *
 * Background: #285. Before the fix, App.tsx mounted <DrawingToolbar> twice — once
 * scoped to the open wizard (correct), and once unconditionally when the wizard
 * was closed (the "free-draw" toolbar). The free-draw toolbar wrote geometry to
 * DrawContext but had no downstream binding to a model run, so users (Neal)
 * drew shapes and saw nothing happen. This regression guard pins the invariant:
 * DrawingToolbar should be mounted exactly once in App.tsx.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('convention: App.tsx mounts no DrawingToolbar', () => {
  it('contains zero <DrawingToolbar … /> JSX sites (it lives in ModelSetupWizard now)', () => {
    const appPath = join(__dirname, '..', 'App.tsx');
    const source = readFileSync(appPath, 'utf-8');
    const matches = source.match(/<DrawingToolbar\b/g) ?? [];
    expect(matches.length).toBe(0);
  });
});
