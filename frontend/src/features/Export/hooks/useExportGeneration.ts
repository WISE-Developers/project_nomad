/**
 * useExportGeneration Hook
 *
 * Manages export bundle generation and download.
 */

import { useState, useCallback } from 'react';
import type {
  ExportRequest,
  ExportResponse,
  ShareLinkResponse,
  BundleManifest,
  ExportState,
  DeliveryMethod,
} from '../types';

const API_BASE = '/api/v1';

interface UseExportGenerationResult {
  /** Current state of export generation */
  state: ExportState;
  /** Export ID after generation */
  exportId: string | null;
  /** Bundle manifest after generation */
  manifest: BundleManifest | null;
  /** Share URL if using share delivery */
  shareUrl: string | null;
  /** Error message if generation failed */
  error: string | null;
  /** Generate an export bundle */
  generate: (request: ExportRequest, delivery: DeliveryMethod) => Promise<void>;
  /** Download the generated export */
  download: () => void;
  /** Reset state to idle */
  reset: () => void;
}

/**
 * Hook for managing export generation
 */
export function useExportGeneration(): UseExportGenerationResult {
  const [state, setState] = useState<ExportState>('idle');
  const [exportId, setExportId] = useState<string | null>(null);
  const [manifest, setManifest] = useState<BundleManifest | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (request: ExportRequest, delivery: DeliveryMethod) => {
    setState('generating');
    setError(null);
    setExportId(null);
    setManifest(null);
    setShareUrl(null);

    try {
      // Step 1: Create the export bundle
      const createRes = await fetch(`${API_BASE}/exports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.message || 'Failed to create export');
      }

      const exportData: ExportResponse = await createRes.json();
      setExportId(exportData.exportId);
      setManifest(exportData.manifest);

      // Step 2: If share delivery, create shareable link
      if (delivery === 'share') {
        const shareRes = await fetch(`${API_BASE}/exports/${exportData.exportId}/share`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        if (!shareRes.ok) {
          const err = await shareRes.json();
          throw new Error(err.message || 'Failed to create share link');
        }

        const shareData: ShareLinkResponse = await shareRes.json();
        setShareUrl(shareData.shareUrl);
      }

      setState('complete');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  }, []);

  const download = useCallback(() => {
    if (!exportId) return;
    // Trigger browser download
    window.location.href = `${API_BASE}/exports/${exportId}/download`;
  }, [exportId]);

  const reset = useCallback(() => {
    setState('idle');
    setExportId(null);
    setManifest(null);
    setShareUrl(null);
    setError(null);
  }, []);

  return {
    state,
    exportId,
    manifest,
    shareUrl,
    error,
    generate,
    download,
    reset,
  };
}
