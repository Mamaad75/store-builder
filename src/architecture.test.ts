import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = (root: string) => walk(root).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (fs: string[]) => fs.map((f) => f.split(path.sep).join("/")).sort();
/** Production sources only: test helpers (src/test) intentionally create rows directly. */
const prodFiles = () => files("src").filter((f) => !f.split(path.sep).includes("test"));
const touchesDb = (f: string) => /from\s+["']@\/lib\/db["']/.test(read(f));

describe("architecture guard: tenant data is only reachable through the owner-scoped layer", () => {
  it("nothing under src/app or src/components imports the DB client or Prisma directly", () => {
    const offenders = [...files("src/app"), ...files("src/components")].filter((f) =>
      /from\s+["'](@\/lib\/db|@prisma\/client)["']/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("every exported Server Action under src/app/dashboard calls requireUser() first", () => {
    // Tenant-data actions live under src/app/dashboard; public auth actions (login/register) are exempt.
    const actionFiles = files("src/app/dashboard").filter((f) => read(f).startsWith('"use server"'));
    expect(actionFiles.length).toBeGreaterThanOrEqual(2); // store actions + catalog actions
    for (const f of actionFiles) {
      const src = read(f);
      const fns = [...src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)/g)];
      expect(fns.length, f).toBeGreaterThan(0);
      for (const [, name, firstLine] of fns) expect(firstLine, `${f}:${name}`).toMatch(/requireUser\(\)/);
    }
  });

  it("only the expected files in each module touch the database", () => {
    expect(rel(files("src/modules/stores").filter(touchesDb))).toEqual([
      "src/modules/stores/mutation.ts",
      "src/modules/stores/repository.ts",
      "src/modules/stores/service.ts",
    ]);
    expect(rel(files("src/modules/products").filter(touchesDb))).toEqual(["src/modules/products/repository.ts"]);
    expect(rel(files("src/modules/categories").filter(touchesDb))).toEqual(["src/modules/categories/repository.ts"]);
  });

  it("Server Components never pass `component={Link}` to MUI (must be done in a client module)", () => {
    const offenders = files("src/app").filter((f) => !read(f).startsWith('"use client"') && /component=\{Link\}/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("architecture guard: catalog writes go through withStoreMutation", () => {
  const catalogRepos = ["src/modules/products/repository.ts", "src/modules/categories/repository.ts"];

  it("product and category rows are only written inside the two catalog repositories", () => {
    const writes = /\.(product|productCategory)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
    const offenders = prodFiles().filter((f) => writes.test(read(f)) && !catalogRepos.includes(f.split(path.sep).join("/")));
    expect(rel(offenders)).toEqual([]);
  });

  it("every exported write function in the catalog repositories requires a MutationContext as first parameter", () => {
    const WRITE_PREFIX = /^(insert|update|rename|delete|detach|set|lock)/;
    let checked = 0;
    for (const f of catalogRepos) {
      for (const m of read(f).matchAll(/export (?:async )?function (\w+)\(([^)]*)/g)) {
        const [, name, params] = m;
        if (!WRITE_PREFIX.test(name!)) continue;
        checked += 1;
        expect(params!.trim(), `${f}:${name}`).toMatch(/^ctx: MutationContext/);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it("only withStoreMutation and the store-settings repository bump draftRevision", () => {
    const bumpers = prodFiles().filter((f) => /draftRevision:\s*\{\s*increment/.test(read(f)));
    expect(rel(bumpers)).toEqual(["src/modules/stores/mutation.ts", "src/modules/stores/repository.ts"]);
  });

  it("withStoreMutation verifies ownership and bumps the revision as its first statement", () => {
    const src = read("src/modules/stores/mutation.ts");
    const firstStatement = src.slice(src.indexOf("db.$transaction("));
    expect(firstStatement.indexOf("tx.store.updateMany")).toBeGreaterThan(-1);
    expect(firstStatement.indexOf("tx.store.updateMany")).toBeLessThan(firstStatement.indexOf("fn({"));
    expect(src).toMatch(/where:\s*\{\s*id:\s*storeId,\s*ownerId\s*\}/);
    expect(src).toMatch(/draftRevision:\s*\{\s*increment:\s*1\s*\}/);
  });

  it("product status is changed only through setStatusRow (never via the generic patch type)", () => {
    const repo = read("src/modules/products/repository.ts");
    const patchType = repo.slice(repo.indexOf("export type ProductPatchRow"), repo.indexOf("export async function updateProductRow"));
    expect(patchType).not.toMatch(/status/);
    expect(repo).toMatch(/export async function setStatusRow/);
  });

  it("stores are created in exactly one place (the user-row-locking service)", () => {
    const creators = prodFiles().filter((f) => /\.store\.(create|createMany|upsert)\b|INSERT INTO "Store"/.test(read(f)));
    expect(rel(creators)).toEqual(["src/modules/stores/service.ts"]);
  });
});

describe("architecture guard: storefront rendering is independent of the dashboard and of data access", () => {
  const FORBIDDEN_IN_TEMPLATES = /from\s+["'](@mui\/[^"']*|@emotion\/[^"']*|next\/[^"']*|next|@prisma\/client|@\/lib\/db|@\/auth|@\/theme\/[^"']*|@\/components\/[^"']*|@\/app\/[^"']*|@\/modules\/[^"']*)["']/;
  const templateFiles = () => files("src/templates");

  it("nothing under src/templates imports MUI, Next, Prisma, the DB, auth, modules or dashboard components", () => {
    const offenders = templateFiles()
      .filter((f) => FORBIDDEN_IN_TEMPLATES.test(read(f)))
      .map((f) => `${f}: ${read(f).match(FORBIDDEN_IN_TEMPLATES)?.[1]}`);
    expect(offenders).toEqual([]);
  });

  it("the generic engine never imports a concrete template (adding a template does not touch the core)", () => {
    const offenders = files("src/templates/engine").filter((f) => /from\s+["'][^"']*(general|coffee|fashion)[^"']*["']/.test(read(f)));
    expect(offenders).toEqual([]);
    // the registry is the single place that knows concrete templates
    const importers = templateFiles().filter((f) => /from\s+["']\.\/general["']/.test(read(f)));
    expect(rel(importers)).toEqual(["src/templates/registry.ts"]);
  });

  it("the root layout does not load the dashboard UI library; dashboard and auth layouts opt in", () => {
    expect(read("src/app/layout.tsx")).not.toMatch(/from\s+["'](@\/theme\/[^"']*|@mui\/[^"']*)["']/);
    for (const f of ["src/app/dashboard/layout.tsx", "src/app/(auth)/layout.tsx"]) expect(read(f), f).toMatch(/from\s+["']@\/theme\/ThemeRegistry["']/);
  });

  it("storefront routes and components render without MUI", () => {
    const offenders = files("src/app/preview").filter((f) => /@mui\//.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("only the storefront repository and the published reader touch the database", () => {
    expect(rel(files("src/modules/storefront").filter(touchesDb))).toEqual(["src/modules/storefront/published.ts", "src/modules/storefront/repository.ts"]);
  });

  it("the draft repository filters by owner and by ACTIVE status in the query itself", () => {
    const src = read("src/modules/storefront/repository.ts");
    expect(src).toMatch(/where:\s*\{\s*id:\s*storeId,\s*ownerId:\s*this\.ownerId\s*\}/);
    expect(src).toMatch(/where:\s*\{\s*status:\s*"ACTIVE"\s*\}/);
    expect(src).not.toMatch(/\.(create|update|upsert|delete)\w*\(/); // read-only
  });

  it("the published reader reads the pinned snapshot only (no live catalog tables)", () => {
    const src = read("src/modules/storefront/published.ts");
    expect(src).toMatch(/publishedVersion/);
    expect(src).not.toMatch(/\bproducts\b|\bcategories\b|\bpages\b|db\.(product|page|productCategory)/);
  });

  it("the preview loader authenticates on the server first, maps NotFoundError to notFound(), and the layout runs it before streaming", () => {
    const load = read("src/app/preview/[storeId]/load.ts");
    expect(load.indexOf("requireUser()")).toBeGreaterThan(-1);
    expect(load.indexOf("requireUser()")).toBeLessThan(load.indexOf("getDraftPreview("));
    expect(load).toMatch(/instanceof NotFoundError/);
    expect(load).toMatch(/notFound\(\)/);
    expect(read("src/app/preview/[storeId]/layout.tsx")).toMatch(/await loadPreview\(/);
    const page = read("src/app/preview/[storeId]/[[...path]]/page.tsx");
    expect(page).toMatch(/await loadPreview\(/);
    expect(page).not.toMatch(/getDraftPreview|@\/lib\/db/); // the page cannot bypass the loader
    expect(page).toMatch(/robots:\s*\{\s*index:\s*false/);
    expect(page).toMatch(/dynamic\s*=\s*"force-dynamic"/);
  });

  it("the proxy and next.config protect and de-index /preview", () => {
    expect(read("src/proxy.ts")).toMatch(/"\/preview\/:path\*"/);
    const cfg = read("next.config.ts");
    expect(cfg).toMatch(/\/preview\/:path\*/);
    expect(cfg).toMatch(/X-Robots-Tag/);
    expect(cfg).toMatch(/no-store/);
  });
});
