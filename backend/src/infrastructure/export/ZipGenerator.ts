/**
 * ZIP Generator
 *
 * Creates streaming ZIP archives from export bundles.
 */

import archiver from 'archiver';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { Writable } from 'stream';
import type { ExportBundle } from './types.js';
import { getExportFormatRegistry } from './ExportFormatRegistry.js';

/**
 * ZIP Generator
 *
 * Creates ZIP archives from export bundles with streaming support.
 */
export class ZipGenerator {
  /**
   * Generate a ZIP archive and pipe it to a writable stream
   *
   * @param bundle The export bundle to archive
   * @param output Writable stream (typically HTTP response)
   * @returns Promise that resolves when archive is complete
   */
  async generateZip(bundle: ExportBundle, output: Writable): Promise<void> {
    const registry = getExportFormatRegistry();

    return new Promise((resolve, reject) => {
      const archive = archiver('zip', {
        zlib: { level: 6 }, // Balanced compression
      });

      // Handle errors
      archive.on('error', (err) => {
        reject(err);
      });

      // Handle warnings (optional - can ignore non-blocking issues)
      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          console.warn('ZIP warning:', err.message);
        } else {
          reject(err);
        }
      });

      // Pipe to output stream
      archive.pipe(output);

      // Add manifest
      const manifestContent = JSON.stringify(bundle.manifest, null, 2);
      archive.append(manifestContent, { name: 'manifest.json' });

      // Add each item
      for (const item of bundle.items) {
        const format = registry.getFormat(item.exportFormat);
        const extension = format?.extension ?? '';

        // Generate a safe filename
        const safeName = this.sanitizeFilename(item.outputName);
        const filename = `${safeName}${extension}`;

        // Check if it's a directory (for shapefiles)
        const stat = statSync(item.filePath);

        if (stat.isDirectory()) {
          // Add all files in the directory (for shapefile bundles)
          this.addDirectory(archive, item.filePath, safeName);
        } else {
          // Add single file
          archive.file(item.filePath, { name: filename });
        }
      }

      // Finalize the archive
      archive.finalize().then(resolve).catch(reject);
    });
  }

  /**
   * Generate a ZIP filename for the bundle
   */
  getFilename(bundle: ExportBundle): string {
    const safeName = this.sanitizeFilename(bundle.manifest.modelName);
    const timestamp = bundle.createdAt.toISOString().slice(0, 10);
    return `${safeName}-export-${timestamp}.zip`;
  }

  /**
   * Add all files from a directory to the archive
   */
  private addDirectory(
    archive: archiver.Archiver,
    dirPath: string,
    baseName: string
  ): void {
    const files = readdirSync(dirPath);

    for (const file of files) {
      const filePath = join(dirPath, file);
      const stat = statSync(filePath);

      if (stat.isFile()) {
        // Use the base name + original extension
        const ext = file.includes('.') ? '.' + file.split('.').pop() : '';
        archive.file(filePath, { name: `${baseName}${ext}` });
      }
    }
  }

  /**
   * Sanitize a string for use as a filename
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\s\-_]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .toLowerCase()
      .slice(0, 50); // Limit length
  }
}

// Singleton instance
let generatorInstance: ZipGenerator | null = null;

/**
 * Get the ZIP generator singleton
 */
export function getZipGenerator(): ZipGenerator {
  if (!generatorInstance) {
    generatorInstance = new ZipGenerator();
  }
  return generatorInstance;
}
