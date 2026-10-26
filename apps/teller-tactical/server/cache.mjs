import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const hash = (key) => createHash('sha256').update(key).digest('hex');

/** Content cache with atomic files, byte budget, LRU eviction, and original retrieval time. */
export class DiskCache {
  constructor(directory, { maxBytes = 256 * 1024 * 1024, now = Date.now } = {}) {
    this.directory = directory;
    this.maxBytes = maxBytes;
    this.now = now;
    this.entries = new Map();
    this.size = 0;
    this.serial = Promise.resolve();
    this.ready = this.load();
  }
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const names = await readdir(this.directory);
    for (const name of names.filter(n => /^[a-f\d]{64}\.json$/.test(n))) {
      try {
        const entry = JSON.parse(await readFile(join(this.directory, name), 'utf8'));
        if (typeof entry.key !== 'string' || hash(entry.key) !== name.slice(0, 64) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > this.maxBytes || !Number.isFinite(entry.expiresAt) || !Number.isFinite(entry.retrievedMs)) continue;
        this.entries.set(entry.key, entry);
        this.size += entry.size;
      } catch { /* Corrupt cache entries are not accepted as data. */ }
    }
    await this.evict();
  }
  async get(key, { allowStale = false } = {}) {
    await this.ready;
    const entry = this.entries.get(key);
    if (!entry || (!allowStale && entry.expiresAt <= this.now())) return null;
    try {
      const data = await readFile(join(this.directory, `${hash(key)}.bin`));
      if (data.length !== entry.size) { await this.remove(key); return null; }
      entry.accessedAt = this.now();
      return { ...entry, data, stale: entry.expiresAt <= this.now(), retrievedAt: new Date(entry.retrievedMs).toISOString(), sourceUrl: key };
    } catch { await this.remove(key); return null; }
  }
  async put(key, data, { ttl = 300_000, contentType = 'application/octet-stream', category = 'image' } = {}) {
    await this.ready;
    if (!Buffer.isBuffer(data)) data = Buffer.from(data);
    if (data.length > this.maxBytes) return;
    const action = async () => {
      const id = hash(key);
      const entry = { key, size: data.length, contentType, category, retrievedMs: this.now(), expiresAt: this.now() + ttl, accessedAt: this.now() };
      const suffix = `.tmp-${process.pid}`;
      await writeFile(join(this.directory, `${id}.bin${suffix}`), data, { mode: 0o600 });
      await rename(join(this.directory, `${id}.bin${suffix}`), join(this.directory, `${id}.bin`));
      await writeFile(join(this.directory, `${id}.json${suffix}`), JSON.stringify(entry), { mode: 0o600 });
      await rename(join(this.directory, `${id}.json${suffix}`), join(this.directory, `${id}.json`));
      this.size -= this.entries.get(key)?.size ?? 0;
      this.entries.set(key, entry);
      this.size += data.length;
      await this.evict();
      return { retrievedAt: new Date(entry.retrievedMs).toISOString() };
    };
    this.serial = this.serial.then(action, action);
    return this.serial;
  }
  async remove(key) {
    const entry = this.entries.get(key);
    if (entry) this.size -= entry.size;
    this.entries.delete(key);
    await Promise.all([rm(join(this.directory, `${hash(key)}.bin`), { force: true }), rm(join(this.directory, `${hash(key)}.json`), { force: true })]);
  }
  async evict() {
    const sorted = [...this.entries.values()].sort((a, b) => a.accessedAt - b.accessedAt);
    while (this.size > this.maxBytes && sorted.length) await this.remove(sorted.shift().key);
  }
  async expireMetadata() {
    await this.ready;
    // Retain last-known metadata for outage recovery; force revalidation on the next request.
    const action = async () => {
      for (const entry of this.entries.values()) {
        if (entry.category !== 'metadata') continue;
        entry.expiresAt = 0;
        await writeFile(join(this.directory, `${hash(entry.key)}.json`), JSON.stringify(entry), { mode: 0o600 });
      }
    };
    this.serial = this.serial.then(action, action);
    await this.serial;
  }
  diagnostics() { return { entries: this.entries.size, bytes: this.size, limitBytes: this.maxBytes }; }
}
