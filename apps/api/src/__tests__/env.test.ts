import { describe, expect, it } from "vitest";
import { EnvError, loadConfig, loadWorkerConfig } from "../config/env.js";

const prod = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://u:SECRETPW@db:5432/x",
  APP_ROOT_DOMAIN: "example.com",
  APP_PROTOCOL: "https",
  TRUST_PROXY_HOPS: "1",
  AUTH_SECRET: "k3Jx9fQ2vLmZp8RtYw1uB6nCdE4gHs7A",
  S3_ENDPOINT: "https://s3.example.net",
  S3_BUCKET: "media-bucket",
  S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
  S3_SECRET_ACCESS_KEY: "s3-secret-value",
  S3_PUBLIC_BASE_URL: "https://media.example.net/media-bucket",
};

describe("loadConfig", () => {
  it("accepts a complete production configuration", () => {
    const c = loadConfig(prod);
    expect(c.production).toBe(true);
    expect(c.port).toBe(4000);
    expect(c.allowedOrigins).toContain("https://example.com");
  });
  it("defaults development to localhost", () => {
    const c = loadConfig({ NODE_ENV: "development", DATABASE_URL: prod.DATABASE_URL });
    expect(c.rootDomain).toBe("localhost:3000");
    expect(c.production).toBe(false);
  });
  it("production needs complete S3 settings, names variables only, and development may go without storage", () => {
    expect(() => loadConfig({ ...prod, S3_BUCKET: undefined })).toThrow(/S3 configuration invalid or missing/);
    try {
      loadConfig({ ...prod, S3_BUCKET: undefined, S3_SECRET_ACCESS_KEY: "leak-me" });
    } catch (e) {
      expect((e as Error).message).not.toContain("leak-me");
    }
    expect(loadConfig({ NODE_ENV: "development", DATABASE_URL: prod.DATABASE_URL }).storage).toBeNull();
    expect(loadConfig(prod).storage?.bucket).toBe("media-bucket");
  });
  it("refuses RATE_LIMIT_BACKEND=memory in production", () => {
    expect(() => loadConfig({ ...prod, RATE_LIMIT_BACKEND: "memory" })).toThrow(/RATE_LIMIT_BACKEND/);
    expect(loadConfig({ NODE_ENV: "development", DATABASE_URL: prod.DATABASE_URL, RATE_LIMIT_BACKEND: "memory" }).rateLimitBackend).toBe("memory");
  });
  it("refuses production without protocol, domain or proxy hops", () => {
    expect(() => loadConfig({ NODE_ENV: "production", DATABASE_URL: prod.DATABASE_URL })).toThrow(EnvError);
    expect(() => loadConfig({ ...prod, TRUST_PROXY_HOPS: "0" })).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => loadConfig({ ...prod, APP_PROTOCOL: "http" })).toThrow(/APP_PROTOCOL/);
  });
  it("requires a strong, non-placeholder AUTH_SECRET in production and has a development default", () => {
    expect(() => loadConfig({ ...prod, AUTH_SECRET: undefined })).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig({ ...prod, AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/);
    expect(() => loadConfig({ ...prod, AUTH_SECRET: "please-change-me-please-change-me-0123456" })).toThrow(/placeholder/);
    expect(loadConfig({ NODE_ENV: "development", DATABASE_URL: prod.DATABASE_URL }).authSecret.length).toBeGreaterThanOrEqual(32);
  });
  it("marks cookies secure only over https", () => {
    expect(loadConfig(prod).secureCookies).toBe(true);
    expect(loadConfig({ ...prod, APP_PROTOCOL: "http", APP_ROOT_DOMAIN: "localhost:3000" }).secureCookies).toBe(false);
  });
  it("allows plain http only on a loopback root", () => {
    expect(loadConfig({ ...prod, APP_PROTOCOL: "http", APP_ROOT_DOMAIN: "localhost:8443" }).protocol).toBe("http");
  });
  it("treats an unknown NODE_ENV as production", () => {
    expect(() => loadConfig({ DATABASE_URL: prod.DATABASE_URL })).toThrow(EnvError);
  });
  it("never puts a value in the error", () => {
    try {
      loadConfig({ ...prod, DATABASE_URL: "mysql://u:SECRETPW@h/x" });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRETPW");
      expect((e as Error).message).not.toContain(prod.AUTH_SECRET);
    }
  });
});

describe("loadWorkerConfig (phase 2.2)", () => {
  const worker = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://u:SECRETPW@db:5432/x",
    REDIS_URL: "redis://:QUEUEPW@valkey:6379",
    AUTH_SECRET: "q7Hc2Ls9Wm4Rt8Yv1Bn6Xk3Pd5Fg0Jz2Aw7Ue9Ir4",
    APP_ROOT_DOMAIN: "example.ir",
    APP_PROTOCOL: "https",
  };
  it("accepts a production configuration with a password-protected queue", () => {
    expect(loadWorkerConfig(worker)).toMatchObject({ production: true, redisUrl: worker.REDIS_URL, orderSms: { rootDomain: "example.ir", protocol: "https", devLog: false } });
  });
  it("phase 3.6: a production worker needs the API's AUTH_SECRET and domain (order links); ORDER_SMS_DEV_LOG only in development", () => {
    for (const k of ["AUTH_SECRET", "APP_ROOT_DOMAIN"] as const) {
      const { [k]: _gone, ...rest } = worker;
      void _gone;
      expect(() => loadWorkerConfig(rest)).toThrow(EnvError);
    }
    expect(() => loadWorkerConfig({ ...worker, ORDER_SMS_DEV_LOG: "true" })).toThrow(EnvError);
    expect(loadWorkerConfig({ NODE_ENV: "development", DATABASE_URL: worker.DATABASE_URL, ORDER_SMS_DEV_LOG: "true" }).orderSms).toMatchObject({ rootDomain: "localhost:3000", devLog: true });
  });
  it("defaults to the local Valkey only in development", () => {
    expect(loadWorkerConfig({ NODE_ENV: "development", DATABASE_URL: worker.DATABASE_URL }).redisUrl).toBe("redis://localhost:6379");
    expect(() => loadWorkerConfig({ NODE_ENV: "production", DATABASE_URL: worker.DATABASE_URL })).toThrow(EnvError);
  });
  it("refuses a production queue without a password, and a non-redis URL; problems name variables, never values", () => {
    for (const REDIS_URL of ["redis://valkey:6379", "http://valkey:6379"]) {
      try {
        loadWorkerConfig({ ...worker, REDIS_URL });
        expect.unreachable(REDIS_URL);
      } catch (e) {
        expect((e as EnvError).problems.join(" ")).toMatch(/^REDIS_URL/);
        expect((e as Error).message).not.toMatch(/SECRETPW|valkey:6379/);
      }
    }
  });
});

describe("secrets master keys (phase 2.4, D24-1)", () => {
  const key = Buffer.alloc(32, 9).toString("base64");
  it("absent = feature off; a valid list + active id = on; half or invalid configuration refuses to start without printing the key", () => {
    expect(loadConfig({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@h:5432/d" }).secrets).toBeNull();
    const on = loadConfig({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@h:5432/d", SECRETS_MASTER_KEYS: `k1:${key}`, SECRETS_ACTIVE_KEY_ID: "k1" }).secrets;
    expect(on?.activeId).toBe("k1");
    for (const env of [{ SECRETS_MASTER_KEYS: `k1:${key}` }, { SECRETS_ACTIVE_KEY_ID: "k1" }, { SECRETS_MASTER_KEYS: "k1:dG9vLXNob3J0", SECRETS_ACTIVE_KEY_ID: "k1" }]) {
      try {
        loadConfig({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@h:5432/d", ...env });
        expect.unreachable(JSON.stringify(Object.keys(env)));
      } catch (e) {
        expect((e as EnvError).problems.join(" ")).toMatch(/SECRETS_/);
        expect((e as Error).message).not.toContain(key);
      }
    }
  });
});
