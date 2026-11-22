import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "__tests__" || n === "test" ? [] : files(p)) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}
// Relative paths always use "/" so the expectations below hold on Windows checkouts too (path.join yields "\" there).
const src = files(ROOT).map((p) => ({ p: p.slice(ROOT.length + 1).split(sep).join("/"), text: readFileSync(p, "utf8") }));

describe("architecture guards", () => {
  it("only config/env.ts reads process.env (main.ts passes it in once; the jobs read theirs in scripts/)", () => {
    const offenders = src.filter((f) => /process\.env/.test(f.text) && !["config/env.ts", "main.ts"].includes(f.p)).map((f) => f.p);
    expect(offenders).toEqual([]);
  });
  it("console is used only by the logger", () => {
    expect(src.filter((f) => /\bconsole\./.test(f.text) && f.p !== "logging/json-logger.ts").map((f) => f.p)).toEqual([]);
    expect(src.filter((f) => /from\s+["']\.\.?\/(?:\.\.\/)*lib\/log\.js["']/.test(f.text)).length).toBeGreaterThan(0); // modules log through the structured logger
  });
  it("only files under database/ import the Prisma client as a value (CommonJS: type imports elsewhere are erased at compile time)", () => {
    expect(src.filter((f) => /^import\s+(?!type\b)[^;]*from\s+["']@prisma\/client["']/m.test(f.text) && !f.p.startsWith("database/")).map((f) => f.p)).toEqual([]);
  });
  it("the queue client (bullmq, ioredis) is imported only by platform/queue/ (phase 2.2)", () => {
    expect(src.filter((f) => /from\s+["'](bullmq|ioredis)["']/.test(f.text) && !f.p.startsWith("platform/queue/")).map((f) => f.p)).toEqual([]);
  });
  it("the API process does not depend on the queue: only the worker composes platform/queue (a Valkey outage cannot stop the API)", () => {
    const users = src.filter((f) => /from\s+["'][^"']*platform\/queue\//.test(f.text) && !f.p.startsWith("platform/queue/")).map((f) => f.p);
    expect(users.every((p) => p.startsWith("worker/")), users.join(", ")).toBe(true);
  });
  it("outbox rows are written only by platform/outbox/ (events are emitted with recordEvent inside the caller's transaction)", () => {
    const writes = /\.outboxEvent\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|(INSERT INTO|UPDATE|DELETE FROM)\s+"OutboxEvent"/;
    expect(src.filter((f) => writes.test(f.text) && !f.p.startsWith("platform/outbox/")).map((f) => f.p)).toEqual([]);
    const outbox = src.find((f) => f.p === "platform/outbox/outbox.ts")!.text;
    expect(outbox).toMatch(/export async function recordEvent\(scope: TransactionScope,/); // a transaction is required by the signature
  });
  it("cipher primitives live only in platform/crypto/ (phase 2.4); only the secrets module and the config use the envelope", () => {
    expect(src.filter((f) => /\b(createCipheriv|createDecipheriv)\b/.test(f.text) && !f.p.startsWith("platform/crypto/")).map((f) => f.p)).toEqual([]);
    const users = src.filter((f) => /from\s+["'][^"']*platform\/crypto\/envelope/.test(f.text)).map((f) => f.p).sort();
    expect(users).toEqual(["config/env.ts", "modules/secrets/infrastructure/compose.ts", "modules/secrets/infrastructure/rotation.ts"]);
  });
  it("no controller can return a secret value: reveal() is never called from the interface layer or any controller", () => {
    // any mention of `reveal` (call, destructuring, bracket access) in an HTTP-facing file fails; so does a service method other than reveal returning open()
    expect(src.filter((f) => (f.p.includes("/interface/") || f.p.endsWith("controller.ts") || f.p.endsWith("controllers.ts")) && /\breveal\b/.test(f.text)).map((f) => f.p)).toEqual([]);
    const svc = src.find((f) => f.p === "modules/secrets/application/secret.service.ts")!.text;
    expect(svc.match(/\.open\(/g)).toHaveLength(1);
    expect(svc.slice(svc.indexOf("async reveal(")).match(/\.open\(/g)).toHaveLength(1);
  });
  it("the metrics library is used only by platform/observability/ (phase 2.6: labels are decided in one place, bounded by construction)", () => {
    expect(src.filter((f) => /from\s+["']prom-client["']/.test(f.text) && !f.p.startsWith("platform/observability/")).map((f) => f.p)).toEqual([]);
  });
  it("no third-party error-tracking SDK: reports go only through the scrubbing reporter of packages/shared (phase 2.6)", () => {
    expect(src.filter((f) => /from\s+["']@sentry\/|from\s+["']@glitchtip/.test(f.text)).map((f) => f.p)).toEqual([]);
  });
  it("relative imports carry the .js suffix (native ESM)", () => {
    const bad = src.flatMap((f) => [...f.text.matchAll(/from "(\.[^"]+)"/g)].filter((m) => !m[1]!.endsWith(".js")).map((m) => `${f.p}: ${m[1]}`));
    expect(bad).toEqual([]);
  });
});
