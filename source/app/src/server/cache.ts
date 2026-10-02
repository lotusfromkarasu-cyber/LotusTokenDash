import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { scopeKey } from './providerScope.js';

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes (fresh)
const DISK_TTL = 60 * 60 * 1000;   // 1 hour (stale but usable)

const CACHE_DIR = join(process.env.LOTUS_DATA_DIR ?? tmpdir(), 'lotus-cache');

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  updatedAt: number;
}

function diskPath(key: string): string {
  const safe = createHash('sha256').update(key).digest('hex');
  return join(CACHE_DIR, `${safe}.json`);
}

class Cache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    key = scopeKey(key);
    const entry = this.store.get(key);
    if (entry && Date.now() <= entry.expiresAt) {
      return entry.data as T;
    }
    return null;
  }

  /** Get data even if stale (for stale-while-revalidate) */
  getStale<T>(key: string): T | null {
    key = scopeKey(key);
    // Try memory first
    const entry = this.store.get(key);
    if (entry) return entry.data as T;

    // Try disk
    return this.readFromDisk<T>(key);
  }

  set<T>(key: string, data: T, ttl: number = DEFAULT_TTL): void {
    key = scopeKey(key);
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + ttl,
      updatedAt: Date.now(),
    };
    this.store.set(key, entry as CacheEntry<unknown>);
    this.writeToDisk(key, entry);
  }

  clear(): void {
    this.store.clear();
    try {
      rmSync(CACHE_DIR, { recursive: true, force: true });
    } catch {
      // Disk cache is best-effort
    }
  }

  delete(key: string): boolean {
    key = scopeKey(key);
    return this.store.delete(key);
  }

  has(key: string): boolean {
    key = scopeKey(key);
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  private writeToDisk<T>(key: string, entry: CacheEntry<T>): void {
    try {
      if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(diskPath(key), JSON.stringify(entry), 'utf-8');
    } catch {
      // Disk cache is best-effort
    }
  }

  private readFromDisk<T>(key: string): T | null {
    try {
      const path = diskPath(key);
      if (!existsSync(path)) return null;
      const raw = readFileSync(path, 'utf-8');
      const entry = JSON.parse(raw) as CacheEntry<T>;
      // Only use disk cache if less than DISK_TTL old
      if (Date.now() - entry.updatedAt < DISK_TTL) {
        // Promote to memory cache (with 0 TTL so it'll be treated as stale)
        this.store.set(key, { ...entry, expiresAt: 0 } as CacheEntry<unknown>);
        return entry.data;
      }
    } catch {
      // Disk cache is best-effort
    }
    return null;
  }
}

export const cache = new Cache();
export type { CacheEntry };
