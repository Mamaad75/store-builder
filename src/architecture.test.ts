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
