/**
 * Export Bundle Builder
 *
 * Builds export bundles containing multiple outputs with format conversion.
 */

import { stat } from 'fs/promises';
import { randomUUID } from 'crypto';
import {
  FireModelId,
  createModelResultId,
  createFireModelId,
} from '../../domain/entities/index.js';
import { getModelResultsService } from '../../application/services/index.js';
import { getFireSTARREngine } from '../firestarr/index.js';
import { resolveResultFilePath } from '../firestarr/FireSTARRInputGenerator.js';
import { getFormatConverter } from './FormatConverter.js';
import { getExportFormatRegistry } from './ExportFormatRegistry.js';
import type { ExportBundle, ExportBundleItem, BundleManifest } from './types.js';

/**
 * Item to add to the bundle
 */
interface BundleItemRequest {
  resultId: string;
  targetFormat?: string;
}

/**
 * Export Bundle Builder
 *
 * Fluent builder for creating export bundles with multiple outputs.
 */
export class ExportBundleBuilder {
  private modelId: FireModelId | null = null;
  private modelName: string = 'Unknown Model';
  private itemRequests: BundleItemRequest[] = [];

  /**
   * Set the model for this bundle
   */
  forModel(modelId: string, modelName?: string): this {
    this.modelId = createFireModelId(modelId);
    this.modelName = modelName ?? `Model ${modelId}`;
    return this;
  }

  /**
   * Add an item to the bundle
   */
  addItem(resultId: string, targetFormat?: string): this {
    this.itemRequests.push({ resultId, targetFormat });
    return this;
  }

  /**
   * Add multiple items to the bundle
   */
  addItems(items: BundleItemRequest[]): this {
    this.itemRequests.push(...items);
    return this;
  }

  /**
   * Build the export bundle
   */
  async build(): Promise<ExportBundle> {
    if (!this.modelId) {
      throw new Error('Model ID is required');
    }

    if (this.itemRequests.length === 0) {
      throw new Error('At least one item is required');
    }

    const engine = getFireSTARREngine();
    const resultsService = getModelResultsService(engine);
    const converter = getFormatConverter();
    const registry = getExportFormatRegistry();

    const items: ExportBundleItem[] = [];
    let totalSize = 0;

    for (const request of this.itemRequests) {
      const typedResultId = createModelResultId(request.resultId);
      const stored = await resultsService.getResultById(typedResultId);

      if (!stored) {
        throw new Error(`Result not found: ${request.resultId}`);
      }

      const result = stored.result;
      const relativeFilePath = result.metadata.filePath as string | undefined;

      if (!relativeFilePath) {
        throw new Error(`Result has no file path: ${request.resultId}`);
      }

      // Resolve relative path to absolute path for file operations
      const filePath = resolveResultFilePath(relativeFilePath);

      // Determine target format
      const targetFormat = request.targetFormat ?? registry.getFormats()
        .find(f => f.id === result.format.toLowerCase())?.id ?? result.format.toLowerCase();

      // Convert if needed
      let finalPath = filePath;
      if (request.targetFormat && registry.canConvert(result.format, request.targetFormat)) {
        finalPath = await converter.convert(filePath, result.format, request.targetFormat);
      }

      // Get file size
      const stats = await stat(finalPath);

      const item: ExportBundleItem = {
        resultId: typedResultId,
        outputName: result.getDisplayName(),
        originalFormat: result.format,
        exportFormat: targetFormat,
        filePath: finalPath,
        fileSize: stats.size,
      };

      items.push(item);
      totalSize += stats.size;
    }

    // Build manifest
    const manifest: BundleManifest = {
      modelName: this.modelName,
      modelId: this.modelId,
      createdAt: new Date().toISOString(),
      itemCount: items.length,
      totalSize,
      items: items.map((item) => ({
        name: item.outputName,
        format: item.exportFormat,
        size: item.fileSize,
      })),
    };

    const bundle: ExportBundle = {
      id: randomUUID(),
      modelId: this.modelId,
      items,
      manifest,
      createdAt: new Date(),
    };

    return bundle;
  }
}

/**
 * In-memory store for export bundles
 * Bundles are ephemeral and will be garbage collected
 */
const bundleStore = new Map<string, ExportBundle>();

// Clean up bundles older than 1 hour
const BUNDLE_TTL_MS = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, bundle] of bundleStore) {
    if (now - bundle.createdAt.getTime() > BUNDLE_TTL_MS) {
      bundleStore.delete(id);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

/**
 * Store a bundle for later retrieval
 */
export function storeBundle(bundle: ExportBundle): void {
  bundleStore.set(bundle.id, bundle);
}

/**
 * Retrieve a stored bundle
 */
export function getBundle(bundleId: string): ExportBundle | undefined {
  return bundleStore.get(bundleId);
}

/**
 * Create a new bundle builder
 */
export function createBundleBuilder(): ExportBundleBuilder {
  return new ExportBundleBuilder();
}
