import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "__tests__" || n === "test" ? [] : files(p)) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}
const src = files(ROOT).map((p) => ({ p: p.slice(ROOT.length + 1), text: readFileSync(p, "utf8") }));

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
  it("relative imports carry the .js suffix (native ESM)", () => {
    const bad = src.flatMap((f) => [...f.text.matchAll(/from "(\.[^"]+)"/g)].filter((m) => !m[1]!.endsWith(".js")).map((m) => `${f.p}: ${m[1]}`));
    expect(bad).toEqual([]);
  });
});
