import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { getStorageConfig } from "./config";
import { mediaPublicUrl, newMediaKey } from "./index";
import { S3MediaStorage } from "./s3";

/**
 * Talks to a REAL S3-compatible server (MinIO in CI). Set STORAGE_TEST_ENFORCES_POLICY=1 when the server enforces
 * bucket policies (MinIO/AWS do; some emulators do not), which enables the "anonymous users are read-only" checks.
 */
const enforces = process.env.STORAGE_TEST_ENFORCES_POLICY === "1";
let storage: S3MediaStorage;
const body = () => sharp({ create: { width: 16, height: 16, channels: 3, background: "teal" } }).webp().toBuffer();
const url = (key: string) => mediaPublicUrl(key)!;

beforeAll(() => {
  storage = new S3MediaStorage(getStorageConfig());
});

describe("S3 storage: put, public read, list, delete", () => {
  it("stores an object that is publicly readable by URL with the right headers", async () => {
    const key = newMediaKey("storetest1");
    const buf = await body();
    await storage.put(key, buf, { contentType: "image/webp" });
    expect(await storage.exists(key)).toBe(true);

    const res = await fetch(url(key)); // anonymous: no credentials
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await res.arrayBuffer()).equals(buf)).toBe(true);
    await storage.delete(key);
  });

  it("delete removes the object (public URL answers 404) and is idempotent", async () => {
    const key = newMediaKey("storetest2");
    await storage.put(key, await body(), { contentType: "image/webp" });
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    expect((await fetch(url(key))).status).toBe(404);
    await expect(storage.delete(key)).resolves.toBeUndefined(); // already gone: still fine
    await expect(storage.delete(newMediaKey("storetest2"))).resolves.toBeUndefined(); // never existed
  });

  it("lists by prefix with pagination and reports size and modification time", async () => {
    const keys = Array.from({ length: 5 }, () => newMediaKey("storelist"));
    for (const k of keys) await storage.put(k, await body(), { contentType: "image/webp" });
    const seen: string[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
      const page = await storage.list("stores/storelist/", { limit: 2, after: token });
      pages++;
      for (const o of page.objects) {
        expect(o.size).toBeGreaterThan(0);
        expect(Math.abs(o.lastModified.getTime() - Date.now())).toBeLessThan(5 * 60_000);
      }
      seen.push(...page.objects.map((o) => o.key));
      token = page.next;
    } while (token);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(seen.sort()).toEqual([...keys].sort());
    for (const k of keys) await storage.delete(k);
    expect((await storage.list("stores/storelist/")).objects).toEqual([]);
  });

  it("refuses to write or delete keys that are not server-generated media keys (no request is made)", async () => {
    for (const bad of ["../../etc/passwd", "stores/x/evil.html", "https://evil.test/x.webp", ""]) {
      await expect(storage.put(bad, Buffer.from("x"), { contentType: "image/webp" })).rejects.toThrow(/invalid media key/);
      await expect(storage.delete(bad)).rejects.toThrow(/invalid media key/);
    }
  });

  it("surfaces transport failures (unreachable endpoint) instead of pretending success", async () => {
    const dead = new S3MediaStorage({ ...getStorageConfig(), endpoint: "http://127.0.0.1:1" });
    await expect(dead.put(newMediaKey("storedead"), Buffer.from("x"), { contentType: "image/webp" })).rejects.toThrow();
    await expect(dead.delete(newMediaKey("storedead"))).rejects.toThrow();
  }, 30_000);
});

/**
 * Each step reports WHICH call failed (a bare "read ECONNRESET" does not say whether it came from the privileged SDK
 * client or from the anonymous request). Labelling only adds context to a failure; it never turns a failure into a pass.
 */
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const err = e as Error & { code?: string; cause?: { code?: string; message?: string } };
    throw new Error(`[${label}] ${err.name}: ${err.message} (code=${err.code ?? err.cause?.code ?? "-"})\n${err.stack ?? ""}`, { cause: e });
  }
}

/** Anonymous access is read-only. The three protections are separate tests: one failing does not hide the others. */
describe.skipIf(!enforces)("public access is read-only (server enforces the bucket policy)", () => {
  it("anonymous users cannot list the bucket", async () => {
    const config = getStorageConfig();
    const listing = await step("anonymous LIST", () => fetch(`${config.publicBaseUrl}/?list-type=2&prefix=stores/`));
    expect(listing.status).toBe(403);
  });

  it("anonymous users cannot write an object", async () => {
    const key = newMediaKey("storeanon");
    const put = await step("anonymous PUT", () => fetch(url(key), { method: "PUT", body: "x" }));
    expect(put.status).toBe(403);
    expect(await step("privileged exists(written key)", () => storage.exists(key))).toBe(false); // independent proof that nothing was written
  });

  it("anonymous users cannot delete an object", async () => {
    const key = newMediaKey("storeanon");
    await step("privileged put(seed object)", async () => storage.put(key, await body(), { contentType: "image/webp" }));
    const del = await step("anonymous DELETE", () => fetch(url(key), { method: "DELETE" }));
    expect(del.status).toBe(403);
    expect(await step("privileged exists(seed object)", () => storage.exists(key))).toBe(true); // the anonymous DELETE had no effect
    await step("privileged delete(seed object)", () => storage.delete(key));
  });
});
