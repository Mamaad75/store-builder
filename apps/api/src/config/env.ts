import { z } from "zod";
import { StorageConfigError, getStorageConfig, type StorageConfig } from "../lib/storage/config.js";
import { DsnError, parseDsn, type Dsn } from "@store-builder/shared/observability/error-report";
import { parseMasterKeys, type MasterKeys } from "../platform/crypto/envelope.js";

/**
 * The ONLY place that interprets environment variables (an architecture test enforces it). Everything else receives the
 * validated `ApiConfig`. Problems name VARIABLES only, never values (they can be secrets).
 *
 * Strictness mirrors the web app (decision D13-3): outside NODE_ENV "development" or "test" the process refuses to start
 * unless the configuration is complete and safe. Plain http is accepted only for a loopback root domain.
 */
export interface ApiConfig {
  nodeEnv: string;
  production: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  /** Bare host name of the platform (the origin the browser app and the API share), e.g. "example.com" or "localhost:3000". */
  rootDomain: string;
  protocol: "http" | "https";
  /** Number of trusted reverse-proxy hops in front of the API (Caddy = 1); 0 trusts no forwarding header. */
  trustProxyHops: number;
  /** Origins allowed to send state-changing requests (see OriginGuard). */
  allowedOrigins: readonly string[];
  /** Maximum JSON body size in bytes. */
  bodyLimitBytes: number;
  /** HMAC secret that signs the session JWT (AUTH_SECRET). Never logged. */
  authSecret: string;
  /** Session cookie lifetime in seconds. */
  sessionMaxAgeSeconds: number;
  /** Object storage (S3-compatible). Required in production; in development `null` means uploads are unavailable. */
  storage: StorageConfig | null;
  /** Where rate-limit counters live ("memory" is for single-process development and tests only). */
  rateLimitBackend: "postgres" | "memory";
  /** True when the platform is served over https: the cookie is then `Secure` and uses the `__Host-` prefix. */
  secureCookies: boolean;
  /**
   * Master keys of the store-secret envelope encryption (phase 2.4, D24-1): SECRETS_MASTER_KEYS + SECRETS_ACTIVE_KEY_ID. null = the
   * secrets feature is off (its endpoints answer "not configured"). Key material never leaves this object and is never logged.
   */
  secrets: MasterKeys | null;
  /** Metrics endpoint and error tracking of this process (phase 2.6). */
  observability: ObservabilityConfig;
}

/**
 * Phase 2.6 (ADR 0002): both parts are optional and OFF when their variables are empty; a value that is set but invalid refuses to start
 * (like the secrets keys), so a typo never silently disables monitoring in production. The DSN is an ingest key: never logged.
 */
export interface ObservabilityConfig {
  /** Prometheus endpoint (METRICS_PORT, METRICS_HOST) on its own port, never routed by the reverse proxy. null = off. */
  metrics: { port: number; host: string } | null;
  /** Error tracking to a self-hosted GlitchTip (ERROR_TRACKING_DSN, ERROR_TRACKING_ENVIRONMENT, APP_RELEASE). null = off. */
  errorTracking: { dsn: Dsn; environment: string; release?: string } | null;
}

export class EnvError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Invalid environment: ${problems.join("; ")}`);
    this.name = "EnvError";
    this.problems = problems;
  }
}

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/i;

const PLACEHOLDER_SECRET = /change[-_ ]?me|example|placeholder|your[-_ ]?secret|secret123|password/i;
const DEV_SECRET = "development-only-secret-not-for-production-0000";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const schema = z.object({
  AUTH_SECRET: z.string().min(32, "at least 32 characters (openssl rand -base64 32)"),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, "a postgresql:// URL"),
  APP_ROOT_DOMAIN: z.string().regex(HOST_RE, "a bare host name, optionally with :port"),
  APP_PROTOCOL: z.enum(["http", "https"]),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  RATE_LIMIT_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
  API_BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).max(10_485_760).default(1_048_576),
});

const blank = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());

/** Reads the phase-2.6 variables; problems are appended (names only). `busyPort` is the API port, which the metrics port may not reuse. */
export function readObservability(env: Record<string, string | undefined>, dev: boolean, problems: string[], busyPort?: number): ObservabilityConfig {
  let metrics: ObservabilityConfig["metrics"] = null;
  const port = blank(env.METRICS_PORT);
  if (port !== undefined) {
    const n = /^\d{1,5}$/.test(port) ? Number(port) : NaN;
    if (!(n >= 1 && n <= 65535) || n === busyPort) problems.push("METRICS_PORT: a free port number (not the API port)");
    // Inside a container the internal network must reach it; on a development machine only this machine.
    else metrics = { port: n, host: blank(env.METRICS_HOST) ?? (dev ? "127.0.0.1" : "0.0.0.0") };
  }
  let errorTracking: ObservabilityConfig["errorTracking"] = null;
  const raw = blank(env.ERROR_TRACKING_DSN);
  if (raw !== undefined) {
    const environment = blank(env.ERROR_TRACKING_ENVIRONMENT) ?? (dev ? "development" : "production");
    const release = blank(env.APP_RELEASE);
    let dsn: Dsn | null = null;
    try {
      dsn = parseDsn(raw);
    } catch (e) {
      if (!(e instanceof DsnError)) throw e;
      problems.push(e.message);
    }
    if (!/^[a-z0-9_-]{1,32}$/i.test(environment)) problems.push("ERROR_TRACKING_ENVIRONMENT: letters, digits, - and _ (at most 32)");
    if (release !== undefined && !/^[\w.+-]{1,64}$/.test(release)) problems.push("APP_RELEASE: letters, digits and . + - _ (at most 64)");
    if (dsn) errorTracking = { dsn, environment, ...(release ? { release } : {}) };
  }
  return { metrics, errorTracking };
}
const isNonProduction = (nodeEnv: string) => nodeEnv === "development" || nodeEnv === "test";
const isLoopbackRoot = (root: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(root);

/**
 * Configuration of the worker process (phase 2.2: outbox relay + queue consumers). The API itself never talks to the queue: it only
 * writes outbox rows, so a Valkey outage cannot take the API down.
 */
export interface WorkerConfig {
  nodeEnv: string;
  production: boolean;
  databaseUrl: string;
  /** Valkey/Redis URL of the queue (secret: may carry a password). Never logged. */
  redisUrl: string;
  observability: ObservabilityConfig;
}

const workerSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, "a postgresql:// URL"),
  REDIS_URL: z.string().regex(/^rediss?:\/\/.+/, "a redis:// or rediss:// URL"),
});

export function loadWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const nodeEnv = env.NODE_ENV ?? "";
  const dev = isNonProduction(nodeEnv);
  const parsed = workerSchema.safeParse({
    DATABASE_URL: blank(env.DATABASE_URL),
    // Development convenience only: the local Valkey of docker-compose.yml. Production has no default.
    REDIS_URL: blank(env.REDIS_URL) ?? (dev ? "redis://localhost:6379" : undefined),
  });
  const problems = parsed.success ? [] : parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`);
  const observability = readObservability(env, dev, problems);
  if (parsed.success && !dev) {
    // Defense in depth: even on the internal network the queue must require a password outside development.
    let password = "";
    try {
      password = new URL(parsed.data.REDIS_URL).password;
    } catch {
      problems.push("REDIS_URL: not a valid URL");
    }
    if (!password && problems.length === 0) problems.push("REDIS_URL: must carry a password in production (redis://:<password>@host:6379)");
  }
  if (problems.length > 0 || !parsed.success) throw new EnvError(problems);
  return { nodeEnv, production: !dev, databaseUrl: parsed.data.DATABASE_URL, redisUrl: parsed.data.REDIS_URL, observability };
}

export function loadConfig(env: Record<string, string | undefined>): ApiConfig {
  const nodeEnv = env.NODE_ENV ?? "";
  const dev = isNonProduction(nodeEnv);
  const parsed = schema.safeParse({
    AUTH_SECRET: blank(env.AUTH_SECRET) ?? (dev ? DEV_SECRET : undefined),
    API_HOST: blank(env.API_HOST),
    API_PORT: blank(env.API_PORT),
    DATABASE_URL: blank(env.DATABASE_URL),
    // Development convenience only: the web app's default root domain. Production has no default.
    APP_ROOT_DOMAIN: blank(env.APP_ROOT_DOMAIN) ?? (dev ? "localhost:3000" : undefined),
    APP_PROTOCOL: blank(env.APP_PROTOCOL) ?? (dev ? "http" : undefined),
    TRUST_PROXY_HOPS: blank(env.TRUST_PROXY_HOPS),
    RATE_LIMIT_BACKEND: blank(env.RATE_LIMIT_BACKEND),
    API_BODY_LIMIT_BYTES: blank(env.API_BODY_LIMIT_BYTES),
  });
  const problems: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`${String(issue.path[0])}: ${issue.message}`);
  }
  const d = parsed.success ? parsed.data : null;
  if (d && !dev) {
    if (d.APP_PROTOCOL !== "https" && !(d.APP_PROTOCOL === "http" && isLoopbackRoot(d.APP_ROOT_DOMAIN))) {
      problems.push('APP_PROTOCOL: must be "https" in production');
    }
    if (PLACEHOLDER_SECRET.test(d.AUTH_SECRET)) problems.push("AUTH_SECRET: looks like a placeholder; generate a real secret");
    if (d.TRUST_PROXY_HOPS < 1) problems.push("TRUST_PROXY_HOPS: must be at least 1 behind the reverse proxy");
  }
  let storage: StorageConfig | null = null;
  try {
    storage = getStorageConfig(env);
  } catch (e) {
    if (!(e instanceof StorageConfigError)) throw e;
    if (!dev) problems.push(e.message.replace("Invalid or missing storage configuration: ", "S3 configuration invalid or missing: "));
  }
  if (d && !dev && d.RATE_LIMIT_BACKEND === "memory") problems.push('RATE_LIMIT_BACKEND: "memory" is for single-process development only');
  const secrets = parseMasterKeys(env.SECRETS_MASTER_KEYS, env.SECRETS_ACTIVE_KEY_ID);
  if (secrets && "error" in secrets) problems.push(secrets.error); // half or invalid configuration refuses to start, in every environment
  const observability = readObservability(env, dev, problems, d?.API_PORT);
  if (problems.length > 0 || !d) throw new EnvError(problems);

  const base = `${d.APP_PROTOCOL}://${d.APP_ROOT_DOMAIN}`;
  const origins = new Set<string>([base, `${d.APP_PROTOCOL}://www.${d.APP_ROOT_DOMAIN}`]);
  if (dev) for (const o of ["http://localhost:3000", "http://localhost:3100"]) origins.add(o);

  return {
    nodeEnv,
    production: !dev,
    host: d.API_HOST,
    port: d.API_PORT,
    databaseUrl: d.DATABASE_URL,
    rootDomain: d.APP_ROOT_DOMAIN,
    protocol: d.APP_PROTOCOL,
    trustProxyHops: d.TRUST_PROXY_HOPS,
    allowedOrigins: [...origins],
    bodyLimitBytes: d.API_BODY_LIMIT_BYTES,
    authSecret: d.AUTH_SECRET,
    sessionMaxAgeSeconds: SESSION_MAX_AGE_SECONDS,
    storage,
    rateLimitBackend: d.RATE_LIMIT_BACKEND,
    secureCookies: d.APP_PROTOCOL === "https",
    secrets: secrets && !("error" in secrets) ? secrets : null,
    observability,
  };
}
