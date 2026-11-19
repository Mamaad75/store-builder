import { describe, expect, it, vi } from "vitest";
import { enforceServerEnvAtStartup, validateServerEnv } from "./server-env";

const GOOD = {
  NODE_ENV: "production",
  INTERNAL_API_URL: "http://api:4000",
  APP_ROOT_DOMAIN: "example.com",
  APP_PROTOCOL: "https",
  TRUST_PROXY_HEADERS: "true",
  TRUSTED_PROXY_HOPS: "1",
  RATE_LIMIT_BACKEND: "postgres",
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
    for (const NODE_ENV of ["staging", "Production", "prod", "", undefined]) expect(validateServerEnv({ ...GOOD, NODE_ENV, INTERNAL_API_URL: "nope" }).ok, String(NODE_ENV)).toBe(false);
  });
  it("each missing or unsafe variable is reported by NAME", () => {
    expect(names({ NODE_ENV: "production" })).toEqual(expect.arrayContaining(["INTERNAL_API_URL", "S3_PUBLIC_BASE_URL", "APP_ROOT_DOMAIN", "APP_PROTOCOL", "TRUST_PROXY_HEADERS"]));
    expect(names({ ...GOOD, INTERNAL_API_URL: undefined })).toEqual(["INTERNAL_API_URL"]);
    expect(names({ ...GOOD, INTERNAL_API_URL: "api:4000" })).toEqual(["INTERNAL_API_URL"]);
    expect(names({ ...GOOD, INTERNAL_API_URL: "http://api:4000/some/path" })).toEqual(["INTERNAL_API_URL"]);
    expect(names({ ...GOOD, APP_PROTOCOL: "http" })).toEqual(["APP_PROTOCOL"]);
    expect(names({ ...GOOD, APP_ROOT_DOMAIN: "https://example.com/" })).toEqual(["APP_ROOT_DOMAIN"]);
    expect(names({ ...GOOD, RATE_LIMIT_BACKEND: "memory" })).toEqual(["RATE_LIMIT_BACKEND"]);
    expect(names({ ...GOOD, TRUST_PROXY_HEADERS: "false" })).toEqual(["TRUST_PROXY_HEADERS"]);
    expect(names({ ...GOOD, TRUSTED_PROXY_HOPS: "0" })).toEqual(["TRUSTED_PROXY_HOPS"]);
    expect(names({ ...GOOD, S3_PUBLIC_BASE_URL: undefined })).toEqual(["S3_PUBLIC_BASE_URL"]);
    expect(names({ ...GOOD, S3_PUBLIC_BASE_URL: "media.example.net" })).toEqual(["S3_PUBLIC_BASE_URL"]);
  });
  it("problems never contain a configured value", () => {
    const secrets = { ...GOOD, INTERNAL_API_URL: "tooShortSecretValue", S3_PUBLIC_BASE_URL: "hunter2://h" };
    const text = JSON.stringify(validateServerEnv(secrets));
    for (const v of ["tooShortSecretValue", "hunter2"]) expect(text).not.toContain(v);
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
    expect(() => enforceServerEnvAtStartup({ ...GOOD, INTERNAL_API_URL: "short-secret-value" }, exit)).toThrow("exit:1");
    const line = JSON.parse(String(err.mock.calls[0]![0])) as { event: string; problems: string[] };
    expect(line.event).toBe("startup.refused");
    expect(JSON.stringify(line)).not.toContain("short-secret-value");
    err.mockClear();
    enforceServerEnvAtStartup(GOOD, exit);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
