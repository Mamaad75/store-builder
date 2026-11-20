import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(import.meta.dirname);
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
const prod = () => walk(ROOT).filter((f) => f.endsWith(".ts") && !/\.test\.ts$/.test(f) && !f.includes(`${path.sep}testing${path.sep}`));
const read = (f: string) => readFileSync(f, "utf8");
const name = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

describe("architecture guard: the shared package is framework-free", () => {
  it("imports no React, Next, MUI, Nest, Prisma or database code (it runs in the browser bundle and in the API)", () => {
    const offenders = prod().filter((f) => /from\s+["'](react|react\/[^"']*|next|next\/[^"']*|@mui\/[^"']*|@nestjs\/[^"']*|@prisma\/client|express)["']/.test(read(f)));
    expect(offenders.map(name)).toEqual([]);
  });
  it("never reads the environment or the request: configuration is passed in", () => {
    const readers = prod().filter((f) => /process\.env/.test(read(f)));
    expect(readers.map(name)).toEqual([]);
  });
  it("relative imports carry the .js suffix (native ESM)", () => {
    const bad = prod().flatMap((f) => [...read(f).matchAll(/from "(\.[^"]+)"/g)].filter((m) => !m[1]!.endsWith(".js")).map((m) => `${name(f)}: ${m[1]}`));
    expect(bad).toEqual([]);
  });
});

describe("architecture guard: SEO (phase 11) builders are pure", () => {
  it("the SEO builders use no database, no request, no Next runtime and no draft module", () => {
    const seo = prod().filter((f) => name(f).startsWith("seo/"));
    expect(seo.length).toBeGreaterThanOrEqual(4);
    for (const f of seo) {
      const src = read(f);
      expect(src, name(f)).not.toMatch(/@prisma\/client|next\/headers|next\/server|next\/navigation|from\s+["']next["']/);
      expect(src, name(f)).not.toMatch(/process\.env|getAppEnv|\bheaders\(/);
    }
  });
});
