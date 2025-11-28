/**
 * Export Format Registry
 *
 * Registry of supported export formats with metadata and conversion capabilities.
 */

import { OutputType, OutputFormat } from '../../domain/entities/index.js';
import type { ExportFormat } from './types.js';

/**
 * All supported export formats
 */
const EXPORT_FORMATS: readonly ExportFormat[] = [
  {
    id: 'geojson',
    name: 'GeoJSON',
    extension: '.geojson',
    mimeType: 'application/geo+json',
    category: 'vector',
    supportedOutputTypes: [
      OutputType.Perimeter,
      OutputType.Probability, // As contours
    ],
  },
  {
    id: 'kml',
    name: 'KML (Google Earth)',
    extension: '.kml',
    mimeType: 'application/vnd.google-earth.kml+xml',
    category: 'vector',
    supportedOutputTypes: [
      OutputType.Perimeter,
      OutputType.Probability, // As contours
    ],
  },
  {
    id: 'shapefile',
    name: 'Shapefile (ESRI)',
    extension: '.shp',
    mimeType: 'application/x-shapefile',
    category: 'vector',
    supportedOutputTypes: [
      OutputType.Perimeter,
      OutputType.Probability, // As contours
    ],
  },
  {
    id: 'geotiff',
    name: 'GeoTIFF',
    extension: '.tif',
    mimeType: 'image/tiff',
    category: 'raster',
    supportedOutputTypes: [
      OutputType.Probability,
      OutputType.Intensity,
      OutputType.RateOfSpread,
      OutputType.FlameLength,
      OutputType.ArrivalTime,
      OutputType.CrownFractionBurned,
    ],
  },
  {
    id: 'png',
    name: 'PNG Image',
    extension: '.png',
    mimeType: 'image/png',
    category: 'raster',
    supportedOutputTypes: [
      OutputType.Probability,
      OutputType.Intensity,
      OutputType.RateOfSpread,
      OutputType.FlameLength,
      OutputType.ArrivalTime,
      OutputType.CrownFractionBurned,
    ],
  },
];

/**
 * Conversion paths from source format to target format
 * Key: sourceFormat-targetFormat
 */
const CONVERSION_PATHS: Record<string, string> = {
  // GeoJSON conversions
  'geojson-kml': 'tokml',
  'geojson-shapefile': 'gdal',
  // GeoTIFF conversions
  'geotiff-png': 'gdal',
  'geotiff-geojson': 'contour', // Generate contours
  // KML conversions
  'kml-geojson': 'togeojson',
};

/**
 * Export Format Registry
 *
 * Provides information about supported export formats and conversion capabilities.
 */
export class ExportFormatRegistry {
  /**
   * Get all registered export formats
   */
  getFormats(): readonly ExportFormat[] {
    return EXPORT_FORMATS;
  }

  /**
   * Get a specific format by ID
   */
  getFormat(id: string): ExportFormat | undefined {
    return EXPORT_FORMATS.find((f) => f.id === id);
  }

  /**
   * Get formats available for a specific output type
   */
  getFormatsForOutputType(outputType: OutputType): ExportFormat[] {
    return EXPORT_FORMATS.filter((f) => f.supportedOutputTypes.includes(outputType));
  }

  /**
   * Check if conversion is possible between formats
   */
  canConvert(from: OutputFormat, to: string): boolean {
    // Same format - no conversion needed
    if (from === to) return true;

    // Map OutputFormat enum to format ID
    const fromId = this.outputFormatToId(from);
    const conversionKey = `${fromId}-${to}`;

    return conversionKey in CONVERSION_PATHS;
  }

  /**
   * Get the conversion method for a format pair
   */
  getConversionMethod(from: OutputFormat, to: string): string | undefined {
    if (from === to) return 'none';

    const fromId = this.outputFormatToId(from);
    const conversionKey = `${fromId}-${to}`;

    return CONVERSION_PATHS[conversionKey];
  }

  /**
   * Map OutputFormat enum to format ID string
   */
  private outputFormatToId(format: OutputFormat): string {
    switch (format) {
      case OutputFormat.GeoJSON:
        return 'geojson';
      case OutputFormat.GeoTIFF:
        return 'geotiff';
      case OutputFormat.Shapefile:
        return 'shapefile';
      case OutputFormat.KML:
        return 'kml';
      default:
        return 'unknown';
    }
  }

  /**
   * Get the file extension for a format
   */
  getExtension(formatId: string): string {
    const format = this.getFormat(formatId);
    return format?.extension ?? '';
  }

  /**
   * Get the MIME type for a format
   */
  getMimeType(formatId: string): string {
    const format = this.getFormat(formatId);
    return format?.mimeType ?? 'application/octet-stream';
  }
}

// Singleton instance
let registryInstance: ExportFormatRegistry | null = null;

/**
 * Get the export format registry singleton
 */
export function getExportFormatRegistry(): ExportFormatRegistry {
  if (!registryInstance) {
    registryInstance = new ExportFormatRegistry();
  }
  return registryInstance;
}
