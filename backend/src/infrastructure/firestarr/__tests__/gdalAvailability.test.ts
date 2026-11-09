/**
 * `isGDALAvailable()` must answer "can these tools run", not "are these names on PATH" (#521).
 *
 * `which` answers a question about the filesystem. A GDAL install can be present and
 * unloadable — a broken shared-library link is the ordinary way — and `which` returns 0
 * for every binary in it. Measured on a host where homebrew's x265 moved 4.1 -> 4.3
 * while libheif still linked libx265.215.dylib: `which gdalwarp` exits 0, `gdalwarp
 * --version` aborts under dyld with rc=134. The guard said available; every call died.
 *
 * The correct shape already existed in this repo, in
 * fuel/__tests__/fuelReproject.test.ts, which invokes the binary and catches the throw.
 * Its comment says why: "a skip that looks like a pass is the thing" to avoid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileSync = vi.fn();
vi.mock('child_process', async (orig) => ({
  ...(await orig<object>()),
  execFileSync,
}));

const { isGDALAvailable } = await import('../PerimeterGenerator.js');

const TOOLS = ['gdal_calc.py', 'gdal_polygonize.py', 'ogr2ogr'];

describe('isGDALAvailable', () => {
  // mockClear, not mockReset. Under vitest 4 a mockReset between tests left the mocked
  // module in a state where a throw from mockImplementation escaped the function's own
  // try/catch and was reported as an unhandled error — including for a plain Error that
  // passed without the reset. The repo's noShellCommands.test.ts uses mockClear for the
  // same mock, and each test below sets its own implementation explicitly.
  beforeEach(() => execFileSync.mockClear());

  it('invokes each tool rather than asking which where it lives', () => {
    execFileSync.mockReturnValue('');

    expect(isGDALAvailable()).toBe(true);

    const commands = execFileSync.mock.calls.map((c) => c[0] as string);
    expect(commands).not.toContain('which');
    for (const tool of TOOLS) {
      expect(commands).toContain(tool);
    }
  });

  it('reports unavailable when a tool is on PATH but aborts when run', () => {
    // Exactly the measured host condition: resolution succeeds, execution does not.
    execFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'ogr2ogr') {
        throw Object.assign(new Error('Library not loaded: libx265.215.dylib'), { status: 134 });
      }
      return '';
    });

    expect(isGDALAvailable()).toBe(false);
  });

  it('reports unavailable when a tool is missing entirely', () => {
    // Scoped to the GDAL tools on purpose. A mock that threw for EVERY command also hit
    // an unrelated, uncaught execFileSync caller elsewhere in the module graph, and that
    // escaping error was reported as this test failing — the test would have been
    // measuring the harness rather than the guard.
    execFileSync.mockImplementation((cmd: string) => {
      if (TOOLS.includes(cmd)) {
        throw Object.assign(new Error(`spawnSync ${cmd} ENOENT`), { code: 'ENOENT' });
      }
      return '';
    });

    expect(isGDALAvailable()).toBe(false);
  });

  it('checks every tool, so one working binary cannot vouch for the others', () => {
    execFileSync.mockReturnValue('');

    isGDALAvailable();

    // The positive half. A guard that returned true after probing only the first tool
    // would satisfy the assertions above.
    const commands = execFileSync.mock.calls.map((c) => c[0] as string);
    expect(new Set(commands)).toEqual(new Set(TOOLS));
  });
});
