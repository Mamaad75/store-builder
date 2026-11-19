import { StorageConfigError, getStorageConfig } from "./storage/config";

/**
 * Production environment validation (decision D13-3). In development and test (NODE_ENV exactly "development" or "test") nothing is
 * demanded. In every other environment the process REFUSES TO START (src/instrumentation.ts) unless the configuration is complete and
 * safe. Problems name VARIABLES only, never values (they can be secrets).
 *
 * One narrow relaxation exists for the E2E suite, which runs a production build on localhost: with a loopback http root domain
 * (localhost / 127.0.0.1 / [::1]) plain http is accepted. No real deployment has such a root domain.
 */
type Env = Record<string, string | undefined>;

const isNonProduction = (env: Env) => env.NODE_ENV === "development" || env.NODE_ENV === "test";
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/i;

export function isLoopbackHttpRoot(env: Env): boolean {
  const host = (env.APP_ROOT_DOMAIN ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  return env.APP_PROTOCOL === "http" && (host === "localhost" || host === "127.0.0.1" || host === "[::1]");
}

export function validateServerEnv(env: Env = process.env): { ok: boolean; problems: string[] } {
  if (isNonProduction(env)) return { ok: true, problems: [] };
  const problems: string[] = [];
  const need = (name: string, why: string) => problems.push(`${name}: ${why}`);

  if (!/^postgres(ql)?:\/\/.+/.test(env.DATABASE_URL ?? "")) need("DATABASE_URL", "required, a postgresql:// URL");

  // Authentication lives in the NestJS API (ADR 0001, N3): the session-signing secret belongs to the API process, this one only needs to reach it.
  const api = (env.INTERNAL_API_URL ?? "").trim();
  if (!api) need("INTERNAL_API_URL", "required in production (internal URL of the API, e.g. http://api:4000)");
  else if (!/^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(api)) need("INTERNAL_API_URL", "must be an http(s) origin without a path");

  const root = (env.APP_ROOT_DOMAIN ?? "").trim();
  if (!root) need("APP_ROOT_DOMAIN", "required in production (no default)");
  else if (!HOST_RE.test(root)) need("APP_ROOT_DOMAIN", "must be a bare host name (optionally with :port), without scheme or path");
  if (env.APP_PROTOCOL !== "https" && !isLoopbackHttpRoot(env)) need("APP_PROTOCOL", 'must be "https" in production');

  if (env.RATE_LIMIT_BACKEND === "memory") need("RATE_LIMIT_BACKEND", '"memory" is for single-process development only');
  if (env.TRUST_PROXY_HEADERS !== "true") need("TRUST_PROXY_HEADERS", 'must be "true" behind the reverse proxy (otherwise every client shares one rate-limit bucket)');
  const hops = env.TRUSTED_PROXY_HOPS;
  if (hops !== undefined && hops !== "" && !/^[1-9]\d?$/.test(hops)) need("TRUSTED_PROXY_HOPS", "must be a small positive integer");

  try {
    getStorageConfig(env);
  } catch (e) {
    if (e instanceof StorageConfigError) problems.push(e.message.replace("Invalid or missing storage configuration: ", "S3 configuration invalid or missing: "));
    else throw e;
  }
  return { ok: problems.length === 0, problems };
}

/** Start-up entry point: prints the problems (names only) and exits 1. */
export function enforceServerEnvAtStartup(env: Env = process.env, exit: (code: number) => never = process.exit): void {
  const r = validateServerEnv(env);
  if (r.ok) return;
  console.error(JSON.stringify({ level: "error", event: "startup.refused", reason: "invalid_environment", problems: r.problems }));
  exit(1);
}
