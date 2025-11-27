/**
 * Local Storage Utilities
 *
 * Safe wrappers for localStorage with JSON serialization,
 * error handling, and optional TTL support.
 */

/**
 * Storage item with metadata
 */
interface StorageItem<T> {
  data: T;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

/**
 * Options for storage operations
 */
interface StorageOptions {
  /** Time-to-live in milliseconds */
  ttl?: number;
}

/**
 * Check if localStorage is available
 */
export function isStorageAvailable(): boolean {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get item from localStorage with JSON parsing
 */
export function getItem<T>(key: string): T | null {
  if (!isStorageAvailable()) return null;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const item: StorageItem<T> = JSON.parse(raw);

    // Check if expired
    if (item.expiresAt && Date.now() > item.expiresAt) {
      localStorage.removeItem(key);
      return null;
    }

    return item.data;
  } catch {
    return null;
  }
}

/**
 * Set item in localStorage with JSON serialization
 */
export function setItem<T>(key: string, data: T, options?: StorageOptions): boolean {
  if (!isStorageAvailable()) return false;

  try {
    const now = Date.now();
    const existing = getRawItem<T>(key);

    const item: StorageItem<T> = {
      data,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: options?.ttl ? now + options.ttl : undefined,
    };

    localStorage.setItem(key, JSON.stringify(item));
    return true;
  } catch (e) {
    // Storage might be full
    console.warn('Failed to save to localStorage:', e);
    return false;
  }
}

/**
 * Remove item from localStorage
 */
export function removeItem(key: string): boolean {
  if (!isStorageAvailable()) return false;

  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get raw storage item with metadata
 */
export function getRawItem<T>(key: string): StorageItem<T> | null {
  if (!isStorageAvailable()) return null;

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Get all keys matching a prefix
 */
export function getKeysByPrefix(prefix: string): string[] {
  if (!isStorageAvailable()) return [];

  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Get all items matching a prefix
 */
export function getItemsByPrefix<T>(prefix: string): Array<{ key: string; data: T; createdAt: number; updatedAt: number }> {
  const keys = getKeysByPrefix(prefix);
  const items: Array<{ key: string; data: T; createdAt: number; updatedAt: number }> = [];

  for (const key of keys) {
    const raw = getRawItem<T>(key);
    if (raw) {
      items.push({
        key,
        data: raw.data,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
      });
    }
  }

  return items;
}

/**
 * Remove all items matching a prefix
 */
export function removeByPrefix(prefix: string): number {
  const keys = getKeysByPrefix(prefix);
  let removed = 0;

  for (const key of keys) {
    if (removeItem(key)) {
      removed++;
    }
  }

  return removed;
}

/**
 * Clean up expired items
 */
export function cleanupExpired(): number {
  if (!isStorageAvailable()) return 0;

  const now = Date.now();
  let cleaned = 0;

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key) continue;

    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const item = JSON.parse(raw);
      if (item.expiresAt && now > item.expiresAt) {
        localStorage.removeItem(key);
        cleaned++;
      }
    } catch {
      // Not our format, skip
    }
  }

  return cleaned;
}

/**
 * Get approximate storage usage
 */
export function getStorageUsage(): { used: number; total: number; percentage: number } {
  if (!isStorageAvailable()) {
    return { used: 0, total: 0, percentage: 0 };
  }

  let used = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key);
      if (value) {
        used += key.length + value.length;
      }
    }
  }

  // localStorage typically has 5MB limit (5 * 1024 * 1024 bytes)
  // But characters are 2 bytes in JS strings
  const total = 5 * 1024 * 1024;
  const percentage = (used / total) * 100;

  return { used, total, percentage };
}

/**
 * Generate a unique ID for drafts
 */
export function generateDraftId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `draft_${timestamp}_${random}`;
}
