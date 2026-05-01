import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveResultFilePath } from '../FireSTARRInputGenerator.js';

// Regression for the Windows bare-metal bug: when FIRESTARR_DATASET_PATH
// is a Windows absolute path (e.g. C:\Users\foo), the previous
// `datasetPath.startsWith('/')` check returned false and the code joined
// the dataset path onto projectRoot, producing nonsense like
// `K:\nomad\project_nomad\C:\Users\foo\sims\<modelId>`.
//
// The fix uses cross-platform absolute detection (`path.win32.isAbsolute`
// OR `path.posix.isAbsolute`) so a Windows-shaped absolute path is
// recognised even when the test runs on POSIX.

describe('resolveResultFilePath — cross-platform absolute path handling', () => {
  let savedDatasetPath: string | undefined;
  let savedNomadDataPath: string | undefined;

  beforeEach(() => {
    savedDatasetPath = process.env.FIRESTARR_DATASET_PATH;
    savedNomadDataPath = process.env.NOMAD_DATA_PATH;
  });

  afterEach(() => {
    if (savedDatasetPath === undefined) delete process.env.FIRESTARR_DATASET_PATH;
    else process.env.FIRESTARR_DATASET_PATH = savedDatasetPath;
    if (savedNomadDataPath === undefined) delete process.env.NOMAD_DATA_PATH;
    else process.env.NOMAD_DATA_PATH = savedNomadDataPath;
  });

  it('preserves a Windows absolute dataset path (does not prepend projectRoot)', () => {
    process.env.FIRESTARR_DATASET_PATH = 'C:\\Users\\test\\firestarr_data';
    const result = resolveResultFilePath('myModelId/perimeter.tif');

    // The resolved path must start with the Windows drive root, not with
    // the test runner's project root. Anything else is the bug.
    expect(result.startsWith('C:')).toBe(true);
    expect(result).not.toContain(process.cwd());
  });

  it('preserves a POSIX absolute dataset path (existing behavior)', () => {
    process.env.FIRESTARR_DATASET_PATH = '/var/data/firestarr';
    const result = resolveResultFilePath('myModelId/perimeter.tif');

    expect(result.startsWith('/var/data/firestarr')).toBe(true);
  });

  it('still resolves relative dataset paths against projectRoot (unchanged)', () => {
    process.env.FIRESTARR_DATASET_PATH = './firestarr_data';
    const result = resolveResultFilePath('myModelId/perimeter.tif');

    // Relative path must get projectRoot-prepended — that branch should not regress.
    expect(result).toContain('firestarr_data');
    // path.join normalizes "./" away
    expect(result).not.toMatch(/^\.\//);
  });
});
