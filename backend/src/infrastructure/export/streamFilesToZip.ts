import archiver from 'archiver';
import type { Writable } from 'stream';

export type ZipBufferEntry = { name: string; content: string | Buffer };
export type ZipFileEntry = { name: string; path: string };
export type ZipEntry = ZipBufferEntry | ZipFileEntry;

export async function streamFilesToZip(
  entries: ZipEntry[],
  output: Writable
): Promise<void> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } });
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    archive.on('error', (err) => settle(() => reject(err)));
    archive.on('warning', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn('[streamFilesToZip] missing file:', err.message);
        return;
      }
      settle(() => reject(err));
    });
    output.on('error', (err) => settle(() => reject(err)));

    archive.pipe(output);

    for (const entry of entries) {
      if ('content' in entry) {
        archive.append(entry.content, { name: entry.name });
      } else {
        archive.file(entry.path, { name: entry.name });
      }
    }

    archive
      .finalize()
      .then(() => settle(() => resolve()))
      .catch((err) => settle(() => reject(err)));
  });
}
