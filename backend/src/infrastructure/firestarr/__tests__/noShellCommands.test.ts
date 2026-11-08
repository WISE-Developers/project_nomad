/**
 * GDAL tools are run with an argument list (execFileSync), never a shell
 * string. A path is then one argument whatever characters it contains, so a
 * file name taken from an upload cannot change the command. These tests keep
 * it that way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const execFileSync = vi.fn((..._args: unknown[]) => JSON.stringify({ size: [1, 1], bands: [] }));
vi.mock('child_process', async (orig) => ({ ...(await orig<object>()), execFileSync }));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('GDAL commands', () => {
  beforeEach(() => execFileSync.mockClear());

  it('no backend source runs a shell string through execSync or exec', () => {
    const src = join(__dirname, '..', '..', '..');
    const offenders = sourceFiles(src).filter((file) =>
      /import\s*\{[^}]*\b(execSync|exec)\b[^}]*\}\s*from\s*['"](node:)?child_process['"]/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('passes a raster path to gdalinfo as one argument, unchanged', async () => {
    const { getRasterBounds } = await import('../ContourGenerator.js');
    const path = '/sims/model 1/arrival (copy).tif';
    try {
      await getRasterBounds(path);
    } catch { /* only the call matters here */ }
    const call = execFileSync.mock.calls.find((c) => c[0] === 'gdalinfo');
    expect(call).toBeDefined();
    expect(call![1]).toContain(path);
  });
});
