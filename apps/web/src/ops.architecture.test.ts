import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Guards for the production-readiness files of phase 13: they cannot be exercised without Docker locally, so their invariants are pinned here. */
// pnpm workspace (ADR 0001, N1): application sources live in apps/web; containers, compose, Caddy, CI, docs and the operations
// scripts stay at the repository root. Paths below are written as before; "src/..." resolves in apps/web, everything else at the root.
const webRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(webRoot, "..", "..");
const read = (f: string) => readFileSync(path.join(f.startsWith("src/") ? webRoot : repoRoot, f), "utf8");

describe("Dockerfile", () => {
  const df = read("Dockerfile");
  it("pins the base image by digest and builds three named targets", () => {
    expect(df).toMatch(/^ARG NODE_IMAGE=node:22-bookworm-slim@sha256:[0-9a-f]{64}$/m);
    for (const t of ["AS runtime", "AS jobs", "AS build", "AS deps"]) expect(df).toContain(t);
  });
  it("the runtime image runs as the unprivileged node user, ships only the standalone output, and never copies secrets or sources", () => {
    const runtime = df.slice(df.indexOf("AS runtime"));
    expect(runtime).toMatch(/^USER node$/m);
    expect(runtime).toContain("/app/apps/web/.next/standalone"); // pnpm workspace layout (ADR 0001, N1)
    expect(runtime).not.toMatch(/COPY\s+(\.|src|scripts|prisma)\b/);
    expect(runtime).not.toMatch(/COPY[^\n]*\.env/);
    expect(df).not.toMatch(/^(ENV|ARG)\s+\w*(SECRET|PASSWORD|TOKEN|KEY)\w*=/m);
  });
  it("health check sends the platform Host header with http.get (fetch cannot override Host) and the server binds all interfaces", () => {
    expect(df).toMatch(/HEALTHCHECK[\s\S]*require\('http'\)\.get[\s\S]*headers:\{host:process\.env\.APP_ROOT_DOMAIN\}/);
    expect(df).toMatch(/CMD \["sh", "-c", "HOSTNAME=0\.0\.0\.0 exec node server\.js"\]/);
  });
  it(".dockerignore keeps secrets, VCS data and local state out of the build context", () => {
    const ig = read(".dockerignore");
    for (const p of [".git", ".env", ".env.*", "node_modules", ".next", "backups"]) expect(ig.split("\n")).toContain(p);
  });
});

describe("docker-compose.prod.yml", () => {
  const c = read("docker-compose.prod.yml");
  it("every image is pinned by digest or built locally (never :latest)", () => {
    for (const m of c.matchAll(/^\s+image:\s*(\S+)/gm)) {
      const image = m[1]!;
      if (image.endsWith(":local")) continue;
      expect(image, image).toMatch(/@sha256:[0-9a-f]{64}$/);
      expect(image).not.toMatch(/:latest/);
    }
  });
  it("PostgreSQL is reachable only on the internal backend network and publishes no port", () => {
    const pg = c.slice(c.indexOf("  postgres:"), c.indexOf("  migrate:"));
    expect(pg).not.toMatch(/^\s+ports:/m);
    expect(pg).toContain("networks: [backend]");
    expect(c).toMatch(/networks:\n  backend:\n    internal: true/);
  });
  it("only Caddy publishes ports (80 and 443); the app is exposed to the edge network only", () => {
    expect([...c.matchAll(/^\s+ports:/gm)]).toHaveLength(1);
    expect(c.slice(c.indexOf("  caddy:"))).toMatch(/- "80:80"[\s\S]*- "443:443"/);
  });
  it("secrets come from the environment and are required; no literal credential is in the file", () => {
    for (const v of ["POSTGRES_PASSWORD", "AUTH_SECRET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "APP_ROOT_DOMAIN"]) expect(c).toMatch(new RegExp(`\\$\\{${v}:\\?`));
    expect(c).not.toMatch(/(PASSWORD|SECRET|TOKEN)\s*:\s*["']?[A-Za-z0-9]{8,}["']?\s*$/m);
  });
  it("production runtime flags: production env, proxy trust for exactly one hop, shared rate limiter, fail-closed mail", () => {
    for (const kv of ["NODE_ENV: production", 'TRUST_PROXY_HEADERS: "true"', 'TRUSTED_PROXY_HOPS: "1"', "RATE_LIMIT_BACKEND: postgres", "MAIL_TRANSPORT: ${MAIL_TRANSPORT:-none}"]) expect(c).toContain(kv);
  });
  it("ADR 0001: the API holds the data credentials alone (database, object storage, session secret), publishes no port and is up before the app", () => {
    const api = c.slice(c.indexOf("  api:"), c.indexOf("  app:"));
    expect(api).toContain("environment: *api-env");
    expect(api).toContain("networks: [backend, edge]"); // edge only for outbound object-storage traffic: nothing routes to it
    expect(api).toContain("read_only: true");
    expect(api).not.toMatch(/^\s+ports:/m);
    expect(c.slice(c.indexOf("x-api-env: &api-env"), c.indexOf("x-hardening"))).toContain("AUTH_SECRET:");
    expect(c.slice(c.indexOf("  migrate:"), c.indexOf("  api:"))).toContain("environment: *api-env");
    const appEnv = c.slice(c.indexOf("x-app-env: &app-env"), c.indexOf("x-api-env: &api-env"));
    for (const v of ["AUTH_SECRET", "DATABASE_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT", "POSTGRES_PASSWORD"]) expect(appEnv, v).not.toContain(v);
    expect(appEnv).toContain("S3_PUBLIC_BASE_URL");
    expect(c.slice(c.indexOf("  app:"), c.indexOf("  scheduler:"))).toMatch(/api: \{ condition: service_healthy \}/);
  });
  it("the app container is hardened: read-only root, no capabilities, no privilege escalation, migrations finish first", () => {
    const app = c.slice(c.indexOf("  app:"), c.indexOf("  scheduler:"));
    expect(app).toContain("read_only: true");
    expect(app).toContain("service_completed_successfully");
    const hard = c.slice(c.indexOf("x-hardening"), c.indexOf("services:"));
    expect(hard).toContain("no-new-privileges:true");
    expect(hard).toContain("cap_drop: [ALL]");
  });
  it("EVERY service, the one-shot migrate job included, inherits the shared hardening; migrate is never restarted", () => {
    const servicesPart = c.slice(c.indexOf("services:"), c.indexOf("\nnetworks:"));
    const names = [...servicesPart.matchAll(/^ {2}([a-z][a-z0-9_-]*):\s*$/gm)].map((m) => m[1]!);
    expect(names).toEqual(expect.arrayContaining(["postgres", "migrate", "api", "app", "scheduler", "caddy"]));
    for (const [i, name] of names.entries()) {
      const start = servicesPart.indexOf(`\n  ${name}:`);
      const end = i + 1 < names.length ? servicesPart.indexOf(`\n  ${names[i + 1]}:`) : servicesPart.length;
      expect(servicesPart.slice(start, end), name).toContain("<<: *hardening");
    }
    expect(c.slice(c.indexOf("  migrate:"), c.indexOf("  app:"))).toContain('restart: "no"');
  });
  it("the scheduler has a real init (signals, reaping) and runs through tsx directly, not through a pnpm wrapper", () => {
    const sched = c.slice(c.indexOf("  scheduler:"), c.indexOf("  caddy:"));
    expect(sched).toContain("init: true");
    expect(sched).toContain('command: ["node_modules/.bin/tsx", "scripts/scheduler.ts"]');
  });
  it("Bale alert credentials reach ONLY the scheduler, from the environment, never as literals (D14-3)", () => {
    const sched = c.slice(c.indexOf("  scheduler:"), c.indexOf("  caddy:"));
    expect(sched).toContain("BALE_BOT_TOKEN: ${BALE_BOT_TOKEN:-}");
    expect(sched).toContain("BALE_CHAT_ID: ${BALE_CHAT_ID:-}");
    expect(sched).toMatch(/environment:\n\s+<<: \*api-env/); // the scheduler keeps every shared app variable
    expect(c.replace(sched, "")).not.toMatch(/BALE_/); // the web app and the other services never see the bot token
    expect(read("scripts/notify-bale.sh")).toMatch(/curl[^\n]*-K -/); // the URL (with the token) goes to curl on stdin, not argv
  });
  it("the smoke override is test-only: throw-away storage, loopback-only ports", () => {
    const s = read("docker-compose.smoke.yml");
    expect(s).toMatch(/CI ONLY/);
    for (const m of s.matchAll(/- "([^"]+)"/g)) expect(m[1], m[1]).toMatch(/^127\.0\.0\.1:/);
  });
});

describe("Caddy", () => {
  const cf = read("docker/caddy/Caddyfile");
  it("REPLACES X-Forwarded-For with the connecting address and strips every other forwarding header the application ignores", () => {
    expect(cf).toContain("header_up X-Forwarded-For {remote_host}");
    for (const h of ["X-Forwarded-Host", "Forwarded", "X-Original-Host", "X-Real-Ip"]) expect(cf).toContain(`header_up -${h}`);
  });
  it("serves the root, www and the wildcard from one site block, and TLS is a swappable snippet", () => {
    expect(cf).toContain("{$APP_ROOT_DOMAIN}, www.{$APP_ROOT_DOMAIN}, *.{$APP_ROOT_DOMAIN}");
    expect(cf).toContain("import tls_config");
    expect(cf).toContain("import tls.d/*.caddy");
  });
  it("the DNS provider is a build argument with no default (decision I-2), pinned builder and runtime images", () => {
    const d = read("docker/caddy/Dockerfile");
    expect(d).toMatch(/^ARG DNS_MODULE=$/m);
    expect(d).toMatch(/xcaddy build \$\{DNS_MODULE:\+--with \$\{DNS_MODULE\}\}/);
    for (const a of ["CADDY_BUILDER", "CADDY_RUNTIME"]) expect(d).toMatch(new RegExp(`^ARG ${a}=caddy:[^@]+@sha256:[0-9a-f]{64}$`, "m"));
  });
  it("the production TLS template reads its token from the environment, never a literal", () => {
    const t = read("docker/caddy/tls.d/tls-dns.caddy.example");
    expect(t).toContain("{env.DNS_API_TOKEN}");
    expect(existsSync(path.join(repoRoot, "docker/caddy/tls.d/tls-dns.caddy"))).toBe(false); // never committed
  });
});

describe("start-up checks, headers and CI", () => {
  it("the instrumentation hook validates the environment before the mail transport", () => {
    const i = read("src/instrumentation.ts");
    expect(i.indexOf("enforceServerEnvAtStartup")).toBeGreaterThan(-1);
    expect(i.indexOf("enforceServerEnvAtStartup(")).toBeLessThan(i.indexOf("enforceMailTransportAtStartup("));
  });
  it("the proxy wraps EVERY route outcome with the security headers", () => {
    const p = read("src/proxy.ts");
    expect(p).toMatch(/export async function proxy[\s\S]*await route\(req\)[\s\S]*securityHeaders\(process\.env\)/);
    expect(p).not.toMatch(/export async function route/); // only the wrapper is exported
  });
  it("the public readiness endpoint is throttled: checkReadiness is the cached single-flight probe, and the route uses nothing else", () => {
    const r = read("src/lib/readiness.ts");
    expect(r).toMatch(/export const checkReadiness: \(\) => Promise<Readiness> = createCachedProbe\(probeReadiness, \{ ttlMs: READINESS_CACHE_MS \}\);/);
    expect(r).not.toMatch(/export async function probeReadiness/); // the uncached probe stays private
    const route = read("src/app/api/ready/route.ts");
    expect(route).toContain("checkReadiness()");
    expect(route).not.toMatch(/\$queryRaw|getMediaStorage/);
  });
  it("CI job-level env blocks never use the `runner` context (GitHub rejects the whole workflow file: run 44268755919)", () => {
    const ci = read(".github/workflows/ci.yml");
    const jobEnvBlocks = [...ci.matchAll(/\n {4}env:\n((?: {6}.*\n)+)/g)].map((m) => m[1]!);
    expect(jobEnvBlocks.length).toBeGreaterThan(0);
    for (const block of jobEnvBlocks) expect(block).not.toMatch(/\$\{\{\s*runner\./);
  });
  it("CI runs the dependency audit and the container smoke test, with no registry login, push or secret", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("pnpm audit --prod --audit-level=high");
    expect(ci).toContain("./scripts/ci-container-smoke.sh");
    expect(ci).not.toMatch(/docker\/login-action|docker login|push:\s*true|\$\{\{\s*secrets\./);
    expect(read("scripts/ci-container-smoke.sh")).not.toMatch(/docker (push|login)|--push/);
  });
  it("the only accepted audit advisory is the documented one", () => {
    const pkg = JSON.parse(read("package.json")) as { pnpm: { auditConfig: { ignoreGhsas: string[] } } };
    expect(pkg.pnpm.auditConfig.ignoreGhsas).toEqual(["GHSA-ggr8-5vv4-36mx"]);
    expect(read("docs/security.md")).toContain("GHSA-ggr8-5vv4-36mx");
  });
  it("the production environment template contains no value for any secret", () => {
    for (const line of read(".env.production.example").split("\n")) {
      const m = /^(\w*(PASSWORD|SECRET|TOKEN|KEY_ID)\w*)=(.*)$/.exec(line);
      if (m) expect(m[3], m[1]).toBe("");
    }
  });
});
