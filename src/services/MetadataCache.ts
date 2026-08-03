import fs from 'node:fs/promises';
import path from 'node:path';
import { cacheDir } from '../core/paths.js';

interface CacheEntry<T> {
  /** File size and mtime at the time the value was computed. */
  size: number;
  mtimeMs: number;
  value: T;
}

/**
 * Persistent on-disk cache for values derived from session files. Entries
 * are invalidated when the source file's size or mtime changes, so a
 * rewritten session is always re-parsed.
 *
 * This is also the seam for future full-text indexing: an index builder
 * writes into a namespace here and readers get the same staleness checks
 * for free.
 */
export class MetadataCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private loaded = false;
  private dirty = false;

  /**
   * `version` must be bumped whenever the producing parser changes, so an
   * upgraded Lazy Claude never serves values computed by older logic.
   */
  constructor(
    private readonly namespace: string,
    private readonly version: number,
  ) {}

  private get file(): string {
    return path.join(cacheDir(), `${this.namespace}.json`);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as {
        version?: number;
        entries?: Record<string, CacheEntry<T>>;
      };
      if (parsed.version !== this.version || !parsed.entries) return;
      this.entries = new Map(Object.entries(parsed.entries));
    } catch {
      // No cache yet, or it is unreadable; start empty.
    }
  }

  get(key: string, size: number, mtimeMs: number): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    // Sub-second mtime precision varies by filesystem, so compare loosely.
    if (entry.size !== size || Math.abs(entry.mtimeMs - mtimeMs) > 1) return null;
    return entry.value;
  }

  set(key: string, size: number, mtimeMs: number, value: T): void {
    this.entries.set(key, { size, mtimeMs, value });
    this.dirty = true;
  }

  /** Drop entries whose key is not in `liveKeys`, so deleted sessions age out. */
  prune(liveKeys: Set<string>): void {
    for (const key of this.entries.keys()) {
      if (!liveKeys.has(key)) {
        this.entries.delete(key);
        this.dirty = true;
      }
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await fs.mkdir(cacheDir(), { recursive: true });
      const payload = { version: this.version, entries: Object.fromEntries(this.entries) };
      await fs.writeFile(this.file, JSON.stringify(payload), 'utf8');
    } catch {
      // A cache write failure must never break the app.
    }
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.dirty = false;
    await fs.rm(this.file, { force: true }).catch(() => {});
  }
}
