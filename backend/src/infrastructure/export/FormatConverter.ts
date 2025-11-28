/**
 * Format Converter
 *
 * Handles conversion between different geospatial formats.
 */

import { spawn } from 'child_process';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { OutputFormat } from '../../domain/entities/index.js';
import { getExportFormatRegistry } from './ExportFormatRegistry.js';
import { generateContours } from '../firestarr/index.js';

// Use dynamic import for tokml (CommonJS module)
let tokmlFn: ((geojson: unknown) => string) | null = null;

/**
 * Format Converter
 *
 * Converts between geospatial formats using various methods:
 * - tokml: GeoJSON → KML
 * - GDAL ogr2ogr: Vector format conversions
 * - GDAL gdal_translate: Raster format conversions
 * - Custom contour generation: GeoTIFF → GeoJSON contours
 */
export class FormatConverter {
  private tempDir: string;

  constructor() {
    this.tempDir = join(tmpdir(), 'nomad-export');
  }

  /**
   * Convert a file from one format to another
   *
   * @param sourcePath Path to the source file
   * @param sourceFormat Original format of the file
   * @param targetFormat Target format ID
   * @returns Path to the converted file
   */
  async convert(
    sourcePath: string,
    sourceFormat: OutputFormat,
    targetFormat: string
  ): Promise<string> {
    const registry = getExportFormatRegistry();
    const method = registry.getConversionMethod(sourceFormat, targetFormat);

    if (!method) {
      throw new Error(`Cannot convert from ${sourceFormat} to ${targetFormat}`);
    }

    if (method === 'none') {
      return sourcePath; // No conversion needed
    }

    // Ensure temp directory exists
    await this.ensureTempDir();

    switch (method) {
      case 'tokml':
        return this.convertGeoJSONToKML(sourcePath);
      case 'gdal':
        return this.convertWithGDAL(sourcePath, sourceFormat, targetFormat);
      case 'contour':
        return this.generateContoursFromRaster(sourcePath);
      case 'togeojson':
        return this.convertKMLToGeoJSON(sourcePath);
      default:
        throw new Error(`Unknown conversion method: ${method}`);
    }
  }

  /**
   * Convert GeoJSON to KML using tokml
   */
  private async convertGeoJSONToKML(sourcePath: string): Promise<string> {
    // Load tokml lazily
    if (!tokmlFn) {
      try {
        const module = await import('tokml');
        tokmlFn = module.default || module;
      } catch {
        throw new Error('tokml module not available');
      }
    }

    const geojsonContent = await readFile(sourcePath, 'utf-8');
    const geojson = JSON.parse(geojsonContent);

    const kml = tokmlFn!(geojson);

    const outputPath = this.getTempPath('.kml');
    await writeFile(outputPath, kml, 'utf-8');

    return outputPath;
  }

  /**
   * Convert KML to GeoJSON
   */
  private async convertKMLToGeoJSON(sourcePath: string): Promise<string> {
    // Use GDAL ogr2ogr for KML to GeoJSON conversion
    const outputPath = this.getTempPath('.geojson');

    await this.runCommand('ogr2ogr', [
      '-f',
      'GeoJSON',
      outputPath,
      sourcePath,
    ]);

    return outputPath;
  }

  /**
   * Convert using GDAL (ogr2ogr or gdal_translate)
   */
  private async convertWithGDAL(
    sourcePath: string,
    _sourceFormat: OutputFormat,
    targetFormat: string
  ): Promise<string> {
    const registry = getExportFormatRegistry();
    const targetFormatInfo = registry.getFormat(targetFormat);

    if (!targetFormatInfo) {
      throw new Error(`Unknown target format: ${targetFormat}`);
    }

    const outputPath = this.getTempPath(targetFormatInfo.extension);

    if (targetFormatInfo.category === 'raster') {
      // Use gdal_translate for raster conversions
      await this.runCommand('gdal_translate', [
        '-of',
        this.getGDALDriverName(targetFormat),
        sourcePath,
        outputPath,
      ]);
    } else {
      // Use ogr2ogr for vector conversions
      const driverName = this.getGDALDriverName(targetFormat);
      const args = ['-f', driverName, outputPath, sourcePath];

      // For shapefiles, we need special handling
      if (targetFormat === 'shapefile') {
        // ogr2ogr creates a directory structure for shapefiles
        const shpDir = this.getTempPath('_shp');
        await mkdir(shpDir, { recursive: true });
        const shpPath = join(shpDir, 'output.shp');
        args[2] = shpPath;
      }

      await this.runCommand('ogr2ogr', args);

      // For shapefiles, return the directory containing all files
      if (targetFormat === 'shapefile') {
        return dirname(outputPath.replace('.shp', '_shp/output.shp'));
      }
    }

    return outputPath;
  }

  /**
   * Generate GeoJSON contours from a GeoTIFF
   */
  private async generateContoursFromRaster(sourcePath: string): Promise<string> {
    const contours = await generateContours(sourcePath);

    const outputPath = this.getTempPath('.geojson');
    await writeFile(outputPath, JSON.stringify(contours), 'utf-8');

    return outputPath;
  }

  /**
   * Get GDAL driver name for a format
   */
  private getGDALDriverName(formatId: string): string {
    const drivers: Record<string, string> = {
      geojson: 'GeoJSON',
      kml: 'KML',
      shapefile: 'ESRI Shapefile',
      geotiff: 'GTiff',
      png: 'PNG',
    };

    return drivers[formatId] ?? 'GeoJSON';
  }

  /**
   * Run an external command
   */
  private runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args);

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run ${command}: ${err.message}`));
      });
    });
  }

  /**
   * Get a unique temp file path
   */
  private getTempPath(extension: string): string {
    const id = randomUUID().slice(0, 8);
    return join(this.tempDir, `export-${id}${extension}`);
  }

  /**
   * Ensure temp directory exists
   */
  private async ensureTempDir(): Promise<void> {
    if (!existsSync(this.tempDir)) {
      await mkdir(this.tempDir, { recursive: true });
    }
  }
}

// Singleton instance
let converterInstance: FormatConverter | null = null;

/**
 * Get the format converter singleton
 */
export function getFormatConverter(): FormatConverter {
  if (!converterInstance) {
    converterInstance = new FormatConverter();
  }
  return converterInstance;
}
