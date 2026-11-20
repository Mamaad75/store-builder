import { z } from "zod";
import { StorageConfigError, getStorageConfig, type StorageConfig } from "../lib/storage/config.js";

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
const isNonProduction = (nodeEnv: string) => nodeEnv === "development" || nodeEnv === "test";
const isLoopbackRoot = (root: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(root);

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
  };
}
