/**
 * Phase 2.1 (ADR 0002 §2.1-2.2): layer direction inside a module and the public API between modules. The rules are written out in
 * docs/architecture/modules.md; change both together.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "..");
const MODULES = join(SRC, "modules");
const LAYERS = ["domain", "application", "infrastructure", "interface"] as const;
type Layer = (typeof LAYERS)[number];
/** Modules that predate the layered layout. They convert when they are next reworked; this list only ever shrinks. */
const LEGACY = ["catalog", "media", "pages", "products", "publishing", "storefront", "stores"];

const posix = (p: string) => p.split(sep).join("/");
const relSrc = (abs: string) => posix(relative(SRC, abs));
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" || n === "test" ? [] : walk(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

interface Import {
  file: string; // importer, relative to src
  spec: string;
  target: string | null; // resolved relative import, relative to src, with the .ts extension
}
const IMPORT_RE = [/^\s*(?:import|export)\b[^;'"]*?\bfrom\s+["']([^"']+)["']/gm, /^\s*import\s+["']([^"']+)["']/gm, /\bimport\(\s*["']([^"']+)["']\s*\)/g];
function importsOf(abs: string): Import[] {
  const text = readFileSync(abs, "utf8");
  const specs = IMPORT_RE.flatMap((re) => [...text.matchAll(re)].map((m) => m[1]!));
  return specs.map((spec) => ({
    file: relSrc(abs),
    spec,
    target: spec.startsWith(".") ? relSrc(resolve(dirname(abs), spec)).replace(/\.js$/, ".ts") : null,
  }));
}

/** "modules/<name>/..." => name; anything else (including files directly under modules/) => null. */
function moduleOf(relPath: string): string | null {
  const parts = relPath.split("/");
  return parts[0] === "modules" && parts.length > 2 ? parts[1]! : null;
}
function layerOf(relPath: string): Layer | "root" | null {
  const parts = relPath.split("/");
  if (parts[0] !== "modules" || parts.length < 3) return null;
  return (LAYERS as readonly string[]).includes(parts[2]!) ? (parts[2] as Layer) : "root";
}

const moduleDirs = readdirSync(MODULES).filter((n) => statSync(join(MODULES, n)).isDirectory());
const layered = moduleDirs.filter((m) => !LEGACY.includes(m));
const allImports = walk(SRC).flatMap(importsOf);
const importsOfLayer = (layer: Layer) => allImports.filter((i) => layered.includes(moduleOf(i.file) ?? "") && layerOf(i.file) === layer);

/** Bare package specifiers a pure layer may use: the framework-free shared package and Zod. */
const PURE_PACKAGES = /^(@store-builder\/shared\/|zod$)/;

describe("architecture guard: module layout (ADR 0002 §2.2)", () => {
  it("the legacy list is accurate and every other module is layered", () => {
    for (const m of LEGACY) expect(moduleDirs, `legacy module ${m} no longer exists: remove it from LEGACY`).toContain(m);
    expect(layered).toContain("categories"); // the reference module, so the rules below are never vacuous
    for (const m of layered) {
      const dir = join(MODULES, m);
      for (const l of ["domain", "application"]) expect(existsSync(join(dir, l)), `${m}/${l}`).toBe(true);
      const rootFiles = readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"));
      expect(rootFiles.sort(), `${m}: only the Nest module and the public API live at the module root`).toEqual([`${m}.api.ts`, `${m}.module.ts`]);
    }
  });

  it("every layered module has unit tests for its domain and application layers", () => {
    for (const m of layered) {
      for (const l of ["domain", "application"]) {
        const tests = readdirSync(join(MODULES, m, l)).filter((n) => n.endsWith(".test.ts"));
        expect(tests.length, `${m}/${l} has no *.test.ts`).toBeGreaterThan(0);
      }
    }
  });
});

describe("architecture guard: dependencies point inward (ADR 0002 §2.2)", () => {
  /** A relative import of the importer's own module, in one of the given layers. */
  const ownLayer = (i: Import, allowed: readonly Layer[]) =>
    i.target !== null && moduleOf(i.target) === moduleOf(i.file) && (allowed as readonly string[]).includes(layerOf(i.target) ?? "");

  it("domain is pure TypeScript: only its own domain files, the shared package and Zod", () => {
    const bad = importsOfLayer("domain").filter((i) => (i.target ? !ownLayer(i, ["domain"]) : !PURE_PACKAGES.test(i.spec)));
    expect(bad.map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });

  it("application uses only its own domain and application files, the shared package and Zod (no Nest, Prisma, HTTP or infrastructure)", () => {
    const bad = importsOfLayer("application").filter((i) => (i.target ? !ownLayer(i, ["domain", "application"]) : !PURE_PACKAGES.test(i.spec)));
    expect(bad.map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });

  it("interface talks to the application layer only: never to infrastructure, Prisma or the database handle", () => {
    const bad = importsOfLayer("interface").filter(
      (i) =>
        /^@prisma\//.test(i.spec) ||
        (i.target !== null && (layerOf(i.target) === "infrastructure" || /^(database\/|lib\/db\.ts$)/.test(i.target))),
    );
    expect(bad.map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });

  it("infrastructure never depends on the interface layer or on the module's own wiring files", () => {
    const bad = importsOfLayer("infrastructure").filter((i) => i.target !== null && moduleOf(i.target) === moduleOf(i.file) && ["interface", "root"].includes(layerOf(i.target) ?? ""));
    expect(bad.map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });

  it("only the infrastructure layer of a layered module reaches the database", () => {
    const db = allImports.filter((i) => layered.includes(moduleOf(i.file) ?? "") && (/^@prisma\//.test(i.spec) || (i.target !== null && /^(database\/|lib\/db\.ts$)/.test(i.target))));
    expect(db.filter((i) => layerOf(i.file) !== "infrastructure").map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });
});

describe("architecture guard: modules talk through their public API (ADR 0002 §2.1)", () => {
  it("a layered module is imported from outside only through <module>.api.ts (app.module.ts may register <module>.module.ts)", () => {
    const bad = allImports.filter((i) => {
      const target = i.target && moduleOf(i.target);
      if (!target || !layered.includes(target) || moduleOf(i.file) === target) return false;
      if (i.target === `modules/${target}/${target}.api.ts`) return false;
      return !(i.file === "app.module.ts" && i.target === `modules/${target}/${target}.module.ts`);
    });
    expect(bad.map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });

  it("a layered module uses any other module (legacy ones too) only through that module's <module>.api.ts", () => {
    const bad = allImports.filter((i) => {
      const from = moduleOf(i.file);
      const target = i.target && moduleOf(i.target);
      return from !== null && layered.includes(from) && target && target !== from && i.target !== `modules/${target}/${target}.api.ts`;
    });
    expect(bad.map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });

  it("the import scanner sees real imports (guards against a silently broken regex)", () => {
    const svc = allImports.filter((i) => i.file === "modules/categories/application/category.service.ts");
    expect(svc.map((i) => i.target ?? i.spec)).toEqual(
      expect.arrayContaining(["zod", "modules/categories/domain/category.ts", "modules/categories/application/ports.ts"]),
    );
    expect(allImports.some((i) => i.file === "app.module.ts" && i.target === "modules/categories/categories.module.ts")).toBe(true);
  });
});

describe("architecture guard: store access (phase 2.3, D23-1)", () => {
  const controllers = walk(SRC).filter((f) => f.endsWith(".controller.ts") || f.endsWith("controllers.ts")).map((f) => ({ p: relSrc(f), text: readFileSync(f, "utf8") }));
  /** Every route handler with its own decorators, its class path and whether the class applies StoreAccessGuard (line scanner). */
  function routes(text: string): { name: string; decorators: string; classPath: string }[] {
    const out: { name: string; decorators: string; classPath: string }[] = [];
    let classPath = "";
    let classDecorators = "";
    let classGuarded = false;
    let pending: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (/^@/.test(line)) classDecorators += line;
      if (/^export class /.test(line)) {
        classPath = classDecorators.match(/@Controller\("([^"]*)"\)/)?.[1] ?? "";
        classGuarded = /StoreAccessGuard/.test(classDecorators);
        classDecorators = "";
        pending = [];
        continue;
      }
      if (/^ {2}@/.test(line)) {
        pending.push(line);
        continue;
      }
      const m = line.match(/^ {2}(?:async )?(\w+)\(/);
      if (m) {
        const decorators = pending.join("\n");
        if (/@(Get|Post|Patch|Put|Delete)\(/.test(decorators)) out.push({ name: m[1]!, decorators: decorators + (classGuarded ? "\n@UseGuards(StoreAccessGuard)" : ""), classPath });
        pending = [];
      }
    }
    return out;
  }

  it("every route under a :storeId path is guarded by StoreAccessGuard and declares its permission", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const c of controllers) {
      for (const r of routes(c.text)) {
        const routePath = r.decorators.match(/@(?:Get|Post|Patch|Put|Delete)\("([^"]*)"\)/)?.[1] ?? "";
        if (!`${r.classPath}/${routePath}`.includes(":storeId")) continue;
        checked++;
        if (!/StoreAccessGuard/.test(r.decorators)) bad.push(`${c.p} ${r.name}: no StoreAccessGuard`);
        if (!/@RequirePermission\("[a-z.]+"\)/.test(r.decorators)) bad.push(`${c.p} ${r.name}: no @RequirePermission`);
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(40); // the scanner really sees the store routes
  });

  it("store routes hand the services the resolved owner, never the session user (a member acts FOR the owner, audited as themself)", () => {
    for (const c of controllers.filter((x) => /StoreAccessGuard/.test(x.text) && !x.p.includes("access/"))) {
      const storeScoped = c.p.endsWith("stores.controller.ts") ? c.text.slice(c.text.indexOf('@Get(":storeId")')) : c.text;
      expect(storeScoped, c.p).not.toMatch(/\buser\.id\b/);
      // legacy services take the owner id (a.ownerId); layered modules take the whole resolved context (store id + real actor)
      expect(storeScoped, c.p).toMatch(/a\.ownerId|this\.\w+\.\w+\(a[,)]/);
    }
  });
});
