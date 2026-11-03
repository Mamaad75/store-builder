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

describe("architecture guard: tenant data is only reachable through the owner-scoped layer", () => {
  it("nothing under src/app or src/components imports the DB client or Prisma directly", () => {
    const offenders = [...files("src/app"), ...files("src/components")].filter((f) =>
      /from\s+["'](@\/lib\/db|@prisma\/client)["']/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("every exported Server Action calls requireUser() first", () => {
    // Tenant-data actions live under src/app/dashboard; public auth actions (login/register) are exempt.
    const actionFiles = files("src/app/dashboard").filter((f) => readFileSync(f, "utf8").startsWith('"use server"'));
    expect(actionFiles.length).toBeGreaterThan(0);
    for (const f of actionFiles) {
      const src = readFileSync(f, "utf8");
      const fns = [...src.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)/g)];
      for (const [, name, firstLine] of fns) {
        expect(firstLine, `${f}:${name}`).toMatch(/requireUser\(\)/);
      }
    }
  });

  it("only repository.ts and service.ts in the stores module touch the database", () => {
    const touching = files("src/modules/stores").filter((f) => /@\/lib\/db/.test(readFileSync(f, "utf8")));
    expect(touching.map((f) => path.basename(f)).sort()).toEqual(["repository.ts", "service.ts"]);
  });

  it("Server Components never pass `component={Link}` to MUI (must be done in a client module)", () => {
    const offenders = files("src/app").filter((f) => {
      const src = readFileSync(f, "utf8");
      return !src.startsWith('"use client"') && /component=\{Link\}/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
