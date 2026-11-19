import { describe, expect, it, vi } from "vitest";
import { enforceServerEnvAtStartup, validateServerEnv } from "./server-env";

const GOOD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:pw@db:5432/app",
  INTERNAL_API_URL: "http://api:4000",
  APP_ROOT_DOMAIN: "example.com",
  APP_PROTOCOL: "https",
  TRUST_PROXY_HEADERS: "true",
  TRUSTED_PROXY_HOPS: "1",
  RATE_LIMIT_BACKEND: "postgres",
  S3_ENDPOINT: "https://s3.example.net",
  S3_BUCKET: "media-bucket",
  S3_ACCESS_KEY_ID: "AKIAEXAMPLE",
  S3_SECRET_ACCESS_KEY: "s3-secret-value",
  S3_PUBLIC_BASE_URL: "https://media.example.net/media-bucket",
};
const names = (env: Record<string, string | undefined>) => validateServerEnv(env).problems.map((p) => p.split(":")[0]);

describe("production environment validation (decision D13-3)", () => {
  it("accepts a complete production configuration", () => {
    expect(validateServerEnv(GOOD)).toEqual({ ok: true, problems: [] });
  });
  it("asks for nothing in development and test", () => {
    for (const NODE_ENV of ["development", "test"]) expect(validateServerEnv({ NODE_ENV })).toEqual({ ok: true, problems: [] });
  });
  it("any other NODE_ENV (staging, empty, unset, misspelled) is production-strict", () => {
    for (const NODE_ENV of ["staging", "Production", "prod", "", undefined]) expect(validateServerEnv({ ...GOOD, NODE_ENV, DATABASE_URL: "mysql://x" }).ok, String(NODE_ENV)).toBe(false);
  });
  it("each missing or unsafe variable is reported by NAME", () => {
    expect(names({ NODE_ENV: "production" })).toEqual(expect.arrayContaining(["DATABASE_URL", "INTERNAL_API_URL", "APP_ROOT_DOMAIN", "APP_PROTOCOL", "TRUST_PROXY_HEADERS"]));
    expect(names({ ...GOOD, INTERNAL_API_URL: undefined })).toEqual(["INTERNAL_API_URL"]);
    expect(names({ ...GOOD, INTERNAL_API_URL: "api:4000" })).toEqual(["INTERNAL_API_URL"]);
    expect(names({ ...GOOD, INTERNAL_API_URL: "http://api:4000/some/path" })).toEqual(["INTERNAL_API_URL"]);
    expect(names({ ...GOOD, APP_PROTOCOL: "http" })).toEqual(["APP_PROTOCOL"]);
    expect(names({ ...GOOD, APP_ROOT_DOMAIN: "https://example.com/" })).toEqual(["APP_ROOT_DOMAIN"]);
    expect(names({ ...GOOD, RATE_LIMIT_BACKEND: "memory" })).toEqual(["RATE_LIMIT_BACKEND"]);
    expect(names({ ...GOOD, TRUST_PROXY_HEADERS: "false" })).toEqual(["TRUST_PROXY_HEADERS"]);
    expect(names({ ...GOOD, TRUSTED_PROXY_HOPS: "0" })).toEqual(["TRUSTED_PROXY_HOPS"]);
    expect(names({ ...GOOD, DATABASE_URL: "mysql://x" })).toEqual(["DATABASE_URL"]);
    expect(names({ ...GOOD, S3_BUCKET: undefined, S3_ENDPOINT: "nope" })).toEqual(["S3 configuration invalid or missing"]);
  });
  it("problems never contain a configured value", () => {
    const secrets = { ...GOOD, INTERNAL_API_URL: "tooShortSecretValue", DATABASE_URL: "mysql://user:hunter2@h/db", S3_SECRET_ACCESS_KEY: "" };
    const text = JSON.stringify(validateServerEnv(secrets));
    for (const v of ["tooShortSecretValue", "hunter2", "mysql://"]) expect(text).not.toContain(v);
  });
  it("plain http is accepted only for a loopback root domain (the E2E suite), never for a real domain", () => {
    expect(validateServerEnv({ ...GOOD, APP_PROTOCOL: "http", APP_ROOT_DOMAIN: "localhost:3100" }).ok).toBe(true);
    for (const d of ["example.com", "localhost.evil.com", "10.0.0.5", "evil.com:3000"]) expect(names({ ...GOOD, APP_PROTOCOL: "http", APP_ROOT_DOMAIN: d }), d).toContain("APP_PROTOCOL");
  });
  it("the start-up entry point prints names only and exits 1; a good configuration is silent", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.fn((c: number): never => {
      throw new Error(`exit:${c}`);
    });
    expect(() => enforceServerEnvAtStartup({ ...GOOD, DATABASE_URL: "mysql://u:short-secret-value@h/x" }, exit)).toThrow("exit:1");
    const line = JSON.parse(String(err.mock.calls[0]![0])) as { event: string; problems: string[] };
    expect(line.event).toBe("startup.refused");
    expect(JSON.stringify(line)).not.toContain("short-secret-value");
    err.mockClear();
    enforceServerEnvAtStartup(GOOD, exit);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
