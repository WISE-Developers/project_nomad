/**
 * Export Types
 *
 * Type definitions for the export infrastructure.
 */

import { OutputType, OutputFormat, ModelResultId, FireModelId } from '../../domain/entities/index.js';

/**
 * Export format metadata
 */
export interface ExportFormat {
  /** Unique identifier (e.g., 'geojson', 'kml') */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** File extension (e.g., '.geojson', '.kml') */
  readonly extension: string;
  /** MIME type */
  readonly mimeType: string;
  /** Whether this is a vector or raster format */
  readonly category: 'vector' | 'raster';
  /** Which output types support this format */
  readonly supportedOutputTypes: readonly OutputType[];
}

/**
 * Export bundle item - a single output in the bundle
 */
export interface ExportBundleItem {
  /** Result ID being exported */
  readonly resultId: ModelResultId;
  /** Display name for the output */
  readonly outputName: string;
  /** Original format of the result */
  readonly originalFormat: OutputFormat;
  /** Target export format ID */
  readonly exportFormat: string;
  /** Path to the file (possibly converted) */
  readonly filePath: string;
  /** File size in bytes */
  readonly fileSize: number;
}

/**
 * Bundle manifest - metadata about the export
 */
export interface BundleManifest {
  /** Model name */
  readonly modelName: string;
  /** Model ID */
  readonly modelId: string;
  /** When the bundle was created */
  readonly createdAt: string;
  /** Number of items in the bundle */
  readonly itemCount: number;
  /** Total size of all files in bytes */
  readonly totalSize: number;
  /** List of items with summary info */
  readonly items: Array<{
    readonly name: string;
    readonly format: string;
    readonly size: number;
  }>;
}

/**
 * Export bundle - collection of outputs ready for download
 */
export interface ExportBundle {
  /** Unique bundle ID */
  readonly id: string;
  /** Model this bundle is from */
  readonly modelId: FireModelId;
  /** Items in the bundle */
  readonly items: ExportBundleItem[];
  /** Bundle manifest */
  readonly manifest: BundleManifest;
  /** When the bundle was created */
  readonly createdAt: Date;
}

/**
 * Request to create an export
 */
export interface ExportRequest {
  /** Model ID */
  readonly modelId: string;
  /** Items to export */
  readonly items: Array<{
    /** Result ID */
    readonly resultId: string;
    /** Optional target format (defaults to original) */
    readonly format?: string;
  }>;
}

/**
 * Shareable link for export download
 */
export interface ShareableLink {
  /** Unique token for the link */
  readonly token: string;
  /** Export bundle ID this link references */
  readonly exportId: string;
  /** When the link was created */
  readonly createdAt: Date;
  /** When the link expires */
  readonly expiresAt: Date;
  /** Maximum number of downloads allowed */
  readonly maxDownloads: number;
  /** Current download count */
  downloadCount: number;
}
