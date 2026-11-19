import { afterEach, describe, expect, it } from "vitest";
import { MemoryMediaStorage } from "@/test/memory-storage";
import { getStorageConfig, getPublicBaseUrl, StorageConfigError } from "./config";
import { mediaPublicUrl, setMediaStorageForTests, getMediaStorage } from "./index";
import { isValidMediaKey, newMediaKey, storeIdOfKey } from "./keys";

const env = {
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "bucket-test",
  S3_ACCESS_KEY_ID: "ak-test-value",
  S3_SECRET_ACCESS_KEY: "sk-very-secret-value",
  S3_PUBLIC_BASE_URL: "http://localhost:9000/bucket-test/",
};

describe("object keys", () => {
  it("are server-generated, bound to the store, and unpredictable", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newMediaKey("ckstore123")));
    expect(keys.size).toBe(200);
    for (const k of keys) {
      expect(k).toMatch(/^stores\/ckstore123\/[0-9a-f]{32}\.webp$/);
      expect(isValidMediaKey(k)).toBe(true);
      expect(storeIdOfKey(k)).toBe("ckstore123");
    }
  });
  it("refuse unsafe store ids and anything that is not exactly the generated shape", () => {
    for (const bad of ["", "../x", "a/b", "a b", "a".repeat(65)]) expect(() => newMediaKey(bad)).toThrow();
    for (const bad of [
      "",
      "stores/s/../../etc/passwd",
      "stores/s/abc.webp",
      `stores/s/${"A".repeat(32)}.webp`,
      `stores/s/${"a".repeat(32)}.svg`,
      `/stores/s/${"a".repeat(32)}.webp`,
      `stores/s/${"a".repeat(32)}.webp/extra`,
      `https://evil.test/stores/s/${"a".repeat(32)}.webp`,
      null,
      42,
    ]) expect(isValidMediaKey(bad as never)).toBe(false);
  });
});

describe("storage configuration", () => {
  it("is validated and normalised", () => {
    const c = getStorageConfig(env);
    expect(c).toMatchObject({ bucket: "bucket-test", forcePathStyle: true, region: "us-east-1", publicBaseUrl: "http://localhost:9000/bucket-test" });
  });
  it("reports only the NAMES of missing settings, never values", () => {
    let e = new Error("not thrown");
    try {
      getStorageConfig({ ...env, S3_BUCKET: "", S3_ENDPOINT: "not a url" });
    } catch (x) {
      e = x as Error;
    }
    expect(e).toBeInstanceOf(StorageConfigError);
    expect(e.message).toMatch(/S3_BUCKET/);
    expect(e.message).toMatch(/S3_ENDPOINT/);
    expect(e.message).not.toContain("sk-very-secret-value");
    expect(e.message).not.toContain("ak-test-value");
  });
  it("the public base URL is readable without any secret", () => {
    expect(getPublicBaseUrl({ S3_PUBLIC_BASE_URL: "https://cdn.example.test/m/" })).toBe("https://cdn.example.test/m");
    expect(() => getPublicBaseUrl({})).toThrow(StorageConfigError);
  });
});

describe("public URL construction (single, configurable place)", () => {
  const prev = process.env.S3_PUBLIC_BASE_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.S3_PUBLIC_BASE_URL;
    else process.env.S3_PUBLIC_BASE_URL = prev;
  });
  const key = `stores/s1/${"a".repeat(32)}.webp`;
  it("is <base>/<key> and follows the configuration, so stored keys never embed a host", () => {
    process.env.S3_PUBLIC_BASE_URL = "http://localhost:9000/bucket-test";
    expect(mediaPublicUrl(key)).toBe(`http://localhost:9000/bucket-test/${key}`);
    process.env.S3_PUBLIC_BASE_URL = "https://cdn.example.test/";
    expect(mediaPublicUrl(key)).toBe(`https://cdn.example.test/${key}`);
  });
  it("never builds a URL for a key that is not a valid media key", () => {
    process.env.S3_PUBLIC_BASE_URL = "https://cdn.example.test";
    for (const bad of ["../x", "https://evil.test/a.webp", "stores/s1/x.webp", ""]) expect(mediaPublicUrl(bad)).toBeNull();
  });
});

describe("MemoryMediaStorage (test double) honours the MediaStorage contract", () => {
  const key = (n: number) => `stores/s1/${n.toString(16).padStart(32, "0")}.webp`;
  it("put/exists/delete, idempotent delete, prefix listing with pagination", async () => {
    const s = new MemoryMediaStorage();
    for (let i = 0; i < 5; i++) await s.put(key(i), Buffer.from("x"), { contentType: "image/webp" });
    expect(await s.exists(key(1))).toBe(true);
    const seen: string[] = [];
    let token: string | undefined;
    do {
      const page = await s.list("stores/", { limit: 2, after: token });
      seen.push(...page.objects.map((o) => o.key));
      token = page.next;
    } while (token);
    expect(seen).toEqual([0, 1, 2, 3, 4].map(key));
    await s.delete(key(1));
    await s.delete(key(1)); // idempotent
    expect(await s.exists(key(1))).toBe(false);
  });
  it("the test seam swaps the storage used by getMediaStorage", () => {
    const s = new MemoryMediaStorage();
    setMediaStorageForTests(s);
    expect(getMediaStorage()).toBe(s);
    setMediaStorageForTests(undefined);
  });
});
