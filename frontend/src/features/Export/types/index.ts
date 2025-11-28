/**
 * Export Types
 *
 * Type definitions for the Export feature.
 */

/**
 * Export format from API
 */
export interface ExportFormat {
  id: string;
  name: string;
  extension: string;
  category: 'vector' | 'raster';
  supportedOutputTypes: string[];
}

/**
 * Item to export
 */
export interface ExportItem {
  resultId: string;
  outputName: string;
  originalFormat: string;
  targetFormat: string;
}

/**
 * Bundle manifest from API
 */
export interface BundleManifest {
  modelName: string;
  modelId: string;
  createdAt: string;
  itemCount: number;
  totalSize: number;
  items: Array<{
    name: string;
    format: string;
    size: number;
  }>;
}

/**
 * Export request
 */
export interface ExportRequest {
  modelId: string;
  modelName?: string;
  items: Array<{
    resultId: string;
    format?: string;
  }>;
}

/**
 * Export response
 */
export interface ExportResponse {
  exportId: string;
  manifest: BundleManifest;
}

/**
 * Share link response
 */
export interface ShareLinkResponse {
  shareUrl: string;
  token: string;
  expiresAt: string;
  maxDownloads: number;
}

/**
 * Delivery method
 */
export type DeliveryMethod = 'download' | 'share';

/**
 * Export state
 */
export type ExportState = 'idle' | 'generating' | 'complete' | 'error';
