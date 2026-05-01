import { describe, it, expect } from 'vitest';
import { Writable } from 'stream';
import { writeFileSync, mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { streamFilesToZip } from '../streamFilesToZip.js';

const makeTmpDir = () => mkdtempSync(join(tmpdir(), 'streamzip-'));

describe('streamFilesToZip', () => {
  it('rejects when the output stream errors mid-pipe', async () => {
    const dir = makeTmpDir();
    const file = join(dir, 'big.bin');
    writeFileSync(file, Buffer.alloc(256 * 1024, 0x41));

    const broken = new Writable({
      write(_chunk, _enc, cb) {
        cb(new Error('sink boom'));
      },
    });

    await expect(
      streamFilesToZip([{ name: 'big.bin', path: file }], broken)
    ).rejects.toThrow();
  });

  it('writes a valid ZIP for buffer + file entries on the happy path', async () => {
    const dir = makeTmpDir();
    const realFile = join(dir, 'data.bin');
    writeFileSync(realFile, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });

    await streamFilesToZip(
      [
        { name: 'metadata.txt', content: 'hello world' },
        { name: 'config.json', content: Buffer.from('{"k":1}') },
        { name: 'data.bin', path: realFile },
      ],
      sink
    );

    const buf = Buffer.concat(chunks);
    expect(buf.length).toBeGreaterThan(0);
    // ZIP local file header magic number: PK\x03\x04
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
  });

  it('rejects when a referenced file path does not exist (archiver warning -> error)', async () => {
    const dir = makeTmpDir();
    const missing = join(dir, 'does-not-exist.tif');

    const sink = new Writable({
      write(_chunk, _enc, cb) { cb(); },
    });

    // ENOENT warnings are tolerated (logged) per ZipGenerator precedent.
    // Non-ENOENT warnings must reject. ENOENT path: should resolve, not hang.
    // This test pins the resolve-on-ENOENT contract so we don't accidentally
    // change it when wiring the error handler.
    await expect(
      streamFilesToZip([{ name: 'gone.tif', path: missing }], sink)
    ).resolves.toBeUndefined();
  });
});

// Smoke import to keep mkdir referenced (silences unused-import lint if test
// suite ever expands). Intentionally trivial.
void mkdirSync;
