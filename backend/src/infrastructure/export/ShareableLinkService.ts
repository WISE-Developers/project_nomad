/**
 * Shareable Link Service
 *
 * Manages shareable download links for export bundles.
 */

import { randomBytes } from 'crypto';
import type { ShareableLink } from './types.js';

/**
 * Default configuration
 */
const DEFAULTS = {
  expiresInHours: 24,
  maxDownloads: 10,
};

/**
 * Shareable Link Service
 *
 * Creates and validates shareable links for export downloads.
 * Links have expiration times and download limits.
 */
export class ShareableLinkService {
  /** In-memory storage for links */
  private links = new Map<string, ShareableLink>();

  /** Base URL for generating share URLs */
  private baseUrl: string;

  constructor(baseUrl: string = process.env.BASE_URL ?? 'http://localhost:3001') {
    this.baseUrl = baseUrl;

    // Cleanup expired links periodically
    setInterval(() => this.cleanupExpired(), 5 * 60 * 1000);
  }

  /**
   * Create a new shareable link for an export bundle
   */
  createLink(
    exportId: string,
    options?: {
      expiresInHours?: number;
      maxDownloads?: number;
    }
  ): ShareableLink {
    const token = this.generateToken();
    const now = new Date();
    const expiresInHours = options?.expiresInHours ?? DEFAULTS.expiresInHours;

    const link: ShareableLink = {
      token,
      exportId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + expiresInHours * 60 * 60 * 1000),
      maxDownloads: options?.maxDownloads ?? DEFAULTS.maxDownloads,
      downloadCount: 0,
    };

    this.links.set(token, link);

    return link;
  }

  /**
   * Validate a token and return the link if valid
   */
  validateToken(token: string): ShareableLink | null {
    const link = this.links.get(token);

    if (!link) {
      return null;
    }

    // Check expiration
    if (new Date() > link.expiresAt) {
      this.links.delete(token);
      return null;
    }

    // Check download limit
    if (link.downloadCount >= link.maxDownloads) {
      return null;
    }

    return link;
  }

  /**
   * Record a download for a link
   */
  recordDownload(token: string): boolean {
    const link = this.links.get(token);

    if (!link) {
      return false;
    }

    link.downloadCount++;

    // Delete if limit reached
    if (link.downloadCount >= link.maxDownloads) {
      // Keep the link for a bit so we can show "limit reached" message
      // It will be cleaned up later
    }

    return true;
  }

  /**
   * Get the shareable URL for a token
   */
  getShareUrl(token: string): string {
    return `${this.baseUrl}/api/v1/share/${token}`;
  }

  /**
   * Get link by token (for internal use)
   */
  getLink(token: string): ShareableLink | undefined {
    return this.links.get(token);
  }

  /**
   * Delete a link
   */
  deleteLink(token: string): boolean {
    return this.links.delete(token);
  }

  /**
   * Generate a secure random token
   */
  private generateToken(): string {
    // 32 bytes = 256 bits of entropy
    // base64url encoding is URL-safe
    return randomBytes(32).toString('base64url');
  }

  /**
   * Clean up expired links
   */
  private cleanupExpired(): void {
    const now = new Date();

    for (const [token, link] of this.links) {
      // Remove if expired or download limit reached (with 1 hour grace period)
      const gracePeriod = 60 * 60 * 1000; // 1 hour
      const isExpired = now.getTime() > link.expiresAt.getTime() + gracePeriod;
      const isExhausted =
        link.downloadCount >= link.maxDownloads &&
        now.getTime() > link.createdAt.getTime() + gracePeriod;

      if (isExpired || isExhausted) {
        this.links.delete(token);
      }
    }
  }
}

// Singleton instance
let serviceInstance: ShareableLinkService | null = null;

/**
 * Get the shareable link service singleton
 */
export function getShareableLinkService(): ShareableLinkService {
  if (!serviceInstance) {
    serviceInstance = new ShareableLinkService();
  }
  return serviceInstance;
}
