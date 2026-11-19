import type { ListPage, MediaStorage } from "@/lib/storage";

type Entry = { body: Buffer; contentType: string; lastModified: Date };

/** In-memory MediaStorage with failure injection and a controllable clock, for tests only. */
export class MemoryMediaStorage implements MediaStorage {
  objects = new Map<string, Entry>();
  failPut: Error | null = null;
  failDelete: Error | null = null;
  /** Runs after the object is stored (used to simulate a crash between storage and database). */
  afterPut: (() => void | Promise<void>) | null = null;
  putCalls = 0;
  deleteCalls = 0;
  now: () => Date = () => new Date();

  async put(key: string, body: Buffer, opts: { contentType: string }) {
    this.putCalls++;
    if (this.failPut) throw this.failPut;
    this.objects.set(key, { body, contentType: opts.contentType, lastModified: this.now() });
    await this.afterPut?.();
  }
  async delete(key: string) {
    this.deleteCalls++;
    if (this.failDelete) throw this.failDelete;
    this.objects.delete(key);
  }
  async list(prefix: string, opts: { limit?: number; after?: string } = {}): Promise<ListPage> {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = opts.after ? keys.findIndex((k) => k > opts.after!) : 0;
    if (start === -1) return { objects: [] };
    const limit = opts.limit ?? 500;
    const slice = keys.slice(start, start + limit);
    return {
      objects: slice.map((k) => ({ key: k, size: this.objects.get(k)!.body.length, lastModified: this.objects.get(k)!.lastModified })),
      next: start + limit < keys.length ? slice[slice.length - 1] : undefined,
    };
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
}
