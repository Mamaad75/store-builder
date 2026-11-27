import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The error registry is imported by the browser code of EVERY storefront page (through the shop client). A file reachable from it that imports zod
 * would ship the validation library (about 38 KB compressed) to every shopper: it happened once, through a message table that lived beside a schema.
 * This walks the runtime (non-type) relative imports from the registry and fails when zod is reachable.
 */
const SRC = resolve(__dirname, "..");
const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm;

function reachable(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const text = readFileSync(file, "utf8");
    const specs = [...text.matchAll(IMPORT_RE)].map((m) => m[1]!);
    seen.set(file, specs);
    for (const s of specs) if (s.startsWith(".")) queue.push(resolve(dirname(file), s.replace(/\.js$/, ".ts")));
  }
  return seen;
}

describe("browser weight of shared code", () => {
  it("the error registry never reaches zod", () => {
    const graph = reachable(join(SRC, "errors", "registry.ts"));
    expect(graph.size).toBeGreaterThan(10); // the walk really followed the imports
    const offenders = [...graph].filter(([, specs]) => specs.some((s) => s === "zod" || s.startsWith("zod/"))).map(([f]) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
  it("the review limits used by the storefront's browser code have no dependencies", () => {
    expect([...reachable(join(SRC, "modules", "reviews", "limits.ts"))].flatMap(([, s]) => s)).toEqual([]);
  });
});
