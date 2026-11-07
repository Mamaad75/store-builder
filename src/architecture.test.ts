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

describe("architecture guard: media and object storage", () => {
  const inFiles = (re: RegExp) => rel(prodFiles().filter((f) => re.test(read(f))));

  it("the AWS SDK is imported only by the S3 storage implementation", () => {
    expect(inFiles(/from\s+["']@aws-sdk\//)).toEqual(["src/lib/storage/s3.ts"]);
  });

  it("sharp is imported only by the image pipeline, and the pipeline is used only by uploadMedia", () => {
    expect(inFiles(/from\s+["']sharp["']/)).toEqual(["src/modules/media/process.ts"]);
    expect(inFiles(/from\s+["'][^"']*\/process["']|from\s+["']\.\/process["']/)).toEqual(["src/modules/media/service.ts"]);
    expect(read("src/modules/media/service.ts").match(/processImage\(/g)).toHaveLength(1);
  });

  it("S3 configuration (secrets) is read only by the storage config module", () => {
    expect(inFiles(/process\.env\.S3_|source\.S3_/)).toEqual(["src/lib/storage/config.ts"]);
  });

  it("application code depends on the MediaStorage interface: only the storage barrel instantiates the S3 implementation", () => {
    expect(inFiles(/new S3MediaStorage\(/)).toEqual(["src/lib/storage/index.ts"]);
    expect(inFiles(/from\s+["'](@\/lib\/storage\/s3|\.\/s3)["']/)).toEqual(["src/lib/storage/index.ts"]);
  });

  it("objects are written (put) in exactly one place: the upload pipeline", () => {
    expect(inFiles(/\bstorage\.put\(/)).toEqual(["src/modules/media/service.ts"]);
  });

  it("media rows are written only by the media repository; references only by their own repositories", () => {
    expect(inFiles(/\.media\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/)).toEqual(["src/modules/media/repository.ts"]);
    expect(inFiles(/data:\s*\{\s*logoId\b/)).toEqual(["src/modules/media/repository.ts"]);
    expect(inFiles(/data:\s*\{\s*imageId\b/)).toEqual(["src/modules/products/repository.ts"]);
  });

  it("every media write that has an owner goes through withStoreMutation (a MutationContext is required)", () => {
    const repo = read("src/modules/media/repository.ts");
    const ownerFns = repo.slice(0, repo.indexOf("// ---- system (cleanup) access"));
    expect(ownerFns).toMatch(/MutationContext/);
    expect(ownerFns).not.toMatch(/\bdb\./); // no direct, un-scoped client in the owner section
  });

  it("templates never import the storage client: only the pure key format", () => {
    const offenders = files("src/templates").filter((f) => /from\s+["']@\/lib\/storage(?!\/keys)/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("the storage URL is built in one place and no hardcoded host is persisted", () => {
    expect(inFiles(/getPublicBaseUrl\(\)/)).toEqual(["src/lib/storage/index.ts"]);
    expect(read("prisma/schema.prisma")).not.toMatch(/https?:\/\//);
    expect(read("src/modules/media/repository.ts")).not.toMatch(/https?:\/\//);
  });

  it("media upload actions authenticate first and Server Action bodies are capped", () => {
    expect(read("src/app/dashboard/media-actions.ts")).toMatch(/uploadMedia\(user\.id/);
    expect(read("next.config.ts")).toMatch(/bodySizeLimit:\s*"6mb"/);
  });
});

describe("architecture guard: page editing (draft only, owner-scoped, template-aware)", () => {
  const inFiles = (re: RegExp) => rel(prodFiles().filter((f) => re.test(read(f))));

  it("page rows are written only by the pages repository (and nested-created with a new store)", () => {
    expect(inFiles(/\.page\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/)).toEqual(["src/modules/pages/repository.ts"]);
    expect(inFiles(/pages:\s*\{\s*create:/)).toEqual(["src/modules/stores/service.ts"]);
  });

  it("every page mutation runs inside withStoreMutation via the single mutatePage (revision check + rollback of no-ops)", () => {
    const src = read("src/modules/pages/service.ts");
    expect(src.match(/withStoreMutation\(/g)).toHaveLength(1);
    expect(src).toMatch(/page\.revision !== expected/);
    expect(src).toMatch(/throw new NoChange\(\)/);
    for (const fn of ["addSection", "updateSection", "removeSection", "moveSection", "setSectionImage", "setPageVisibility", "recoverPage"]) {
      expect(src, fn).toMatch(new RegExp(`export async function ${fn}\\([\\s\\S]*?mutatePage\\(`));
    }
  });

  it("the repository writes pages only with the revision the caller verified, and the owner in the SQL condition", () => {
    const src = read("src/modules/pages/repository.ts");
    expect(src).toMatch(/revision:\s*page\.revision/);
    expect(src).toMatch(/store:\s*\{\s*ownerId:\s*ctx\.ownerId\s*\}/);
    expect(src).toMatch(/store:\s*\{\s*ownerId:\s*this\.ownerId\s*\}/);
  });

  it("the editing service names no concrete template: approved sections come from the template's editor spec", () => {
    const offenders = files("src/modules/pages").filter((f) => /["'](general|coffee|fashion)["']/.test(read(f)));
    expect(offenders).toEqual([]);
    expect(read("src/templates/types.ts")).toMatch(/readonly editor: EditorSpec/);
  });

  it("hiding is guarded by NON_HIDEABLE_PAGES in the service", () => {
    expect(read("src/modules/pages/service.ts")).toMatch(/NON_HIDEABLE_PAGES\.includes\(type\)/);
  });

  it("no raw HTML injection and no external fonts/stylesheets anywhere in the app or templates", () => {
    expect(inFiles(/dangerouslySetInnerHTML/)).toEqual([]);
    expect(inFiles(/@import\s+url\(|fonts\.googleapis|fonts\.gstatic|<link[^>]+stylesheet/)).toEqual([]);
    expect(read("src/templates/general/general.module.css")).not.toMatch(/@import|url\(\s*["']?https?:/);
  });

  it("the page editor actions authenticate first and the editing UI imports no data layer", () => {
    expect(read("src/app/dashboard/pages-actions.ts")).toMatch(/export async function pageEditAction\([^)]*\)[^{]*\{\n\s*const user = await requireUser\(\)/);
    const offenders = files("src/components/pages").filter((f) => /from\s+["'](@\/lib\/db|@prisma\/client|@\/modules\/[^"']*repository)["']/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe("architecture guard: business category, themes and the section registry (phase 9A)", () => {
  const inFiles = (re: RegExp, roots = prodFiles()) => rel(roots.filter((f) => re.test(read(f))));

  it("the renderer side never reads the business category (themes, engine, preview routes, storefront data)", () => {
    const roots = [...files("src/templates"), ...files("src/app/preview"), ...files("src/modules/storefront"), ...files("src/modules/pages"), ...files("src/modules/products"), ...files("src/modules/categories"), ...files("src/modules/media")];
    expect(inFiles(/businessCategory|business-categories/, roots)).toEqual([]);
  });

  it("the category is written only by store creation and by the dedicated compare-and-set (no draftRevision involved)", () => {
    expect(inFiles(/businessCategory:\s*(category\.key|next)\b/)).toEqual(["src/modules/stores/repository.ts", "src/modules/stores/service.ts"]);
    const repo = read("src/modules/stores/repository.ts");
    const fn = repo.slice(repo.indexOf("async setBusinessCategory"), repo.indexOf("/** Optimistic update"));
    expect(fn).toMatch(/ownerId:\s*this\.ownerId/);
    expect(fn).toMatch(/businessCategory:\s*expected/);
    expect(fn).not.toMatch(/draftRevision/);
  });

  it("starter text is applied during creation only (the category update never touches pages)", () => {
    expect(inFiles(/applyStarterCopy\(/)).toEqual(["src/modules/stores/service.ts", "src/modules/stores/starter-content.ts"]);
    const svc = read("src/modules/stores/service.ts");
    const update = svc.slice(svc.indexOf("export async function updateBusinessCategory"), svc.indexOf("export async function deleteStore"));
    expect(update).not.toMatch(/page|applyStarterCopy|settings|product/i);
  });

  it("the database CHECK validates only the key format: no category name appears in it, and the migration adds no allowlist", () => {
    const dir = readdirSync("prisma/migrations").find((d) => d.includes("phase9a_business_category"))!;
    const sql = read(`prisma/migrations/${dir}/migration.sql`);
    const check = sql.split("\n").find((l) => l.includes("ADD CONSTRAINT \"Store_businessCategory_format\""))!;
    expect(check).toMatch(/\^\[a-z\]\[a-z0-9-\]\{0,39\}\$/);
    expect(check).not.toMatch(/coffee|fashion|appliances|general|IN \(/);
    expect(read("prisma/schema.prisma")).not.toMatch(/enum\s+\w*Category/i);
  });

  it("the core engine and the section registry name no concrete theme or business category", () => {
    const core = [
      ...files("src/templates/engine"),
      "src/templates/section-registry.ts",
      "src/templates/section-parse.ts",
      "src/templates/sections.ts",
      "src/templates/types.ts",
      "src/templates/editor.ts",
      "src/templates/theme.ts",
      "src/templates/storefront-data.ts",
    ];
    for (const f of core) expect(read(f), f).not.toMatch(/["'](general|coffee|fashion|coffee-food|home-appliances)["']/);
  });

  it("only the catalogs know concrete themes: one pure catalog and one React registry", () => {
    expect(inFiles(/from\s+["']\.\/(general|coffee|fashion)\/definition["']/, files("src/templates"))).toEqual(["src/templates/theme-catalog.ts"]);
    expect(inFiles(/from\s+["']\.\/(general|coffee|fashion)["']/, files("src/templates"))).toEqual(["src/templates/registry.ts"]);
  });

  it("theme definitions are pure (no React, no CSS, no data layer) so server code and scripts can use them", () => {
    for (const f of files("src/templates").filter((x) => /\/definition\.ts$|\/editor\.ts$/.test(x.split(path.sep).join("/")))) {
      expect(read(f), f).not.toMatch(/from\s+["'](react|react-dom|[^"']*\.css|@\/modules|@\/lib\/db|@prisma\/client)/);
    }
    for (const f of ["src/templates/theme-catalog.ts", "src/templates/section-registry.ts", "src/templates/section-parse.ts"]) {
      expect(read(f), f).not.toMatch(/from\s+["'](react|react-dom|[^"']*\.css)/);
    }
  });

  it("editing and store creation use the PURE catalog (never the React registry), and extra section types are namespaced by theme", () => {
    expect(inFiles(/from\s+["']@\/templates\/registry["']/, [...files("src/modules"), ...files("src/app/dashboard"), ...files("src/components")])).toEqual([]);
    const reg = read("src/templates/section-registry.ts");
    expect(reg).toMatch(/startsWith\(`\$\{theme\.key\}\.`\)/);
  });

  it("dormant handling keeps stored values: edits serialize the stored raw value of every entry", () => {
    const svc = read("src/modules/pages/service.ts");
    expect(svc).toMatch(/serializeEntries\(out\.entries\)/);
    expect(read("src/modules/pages/analyze.ts")).toMatch(/raw: item/);
    expect(svc).toMatch(/export async function removeDormantSection/);
    expect(svc).toMatch(/e\.kind === "dormant" && e\.section\.id === sid\.data/);
  });
});

describe("architecture guard: theme switching and candidate preview (phase 9B)", () => {
  const WRITE_CALL = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$queryRaw/;
  const inFiles = (re: RegExp) => rel(prodFiles().filter((f) => re.test(read(f))));

  it("the theme pointer is written in exactly one place (repository), only inside a store mutation, and by nothing else", () => {
    expect(inFiles(/templateVersionId:\s*nextVersionId/)).toEqual(["src/modules/stores/repository.ts"]);
    const sw = read("src/modules/stores/theme-switch.ts");
    expect(sw).toMatch(/withStoreMutation\(ownerId, id,/);
    expect(sw).toMatch(/setTemplateVersionInTx\(/);
    // the switch service reaches no table other than through the store repository: no page, media, product or snapshot access
    expect(sw).not.toMatch(WRITE_CALL);
    expect(sw).not.toMatch(/from\s+["']@\/lib\/db["']|@\/modules\/(media|products|categories)|writePage|storeVersion/i);
    const repo = read("src/modules/stores/repository.ts");
    const write = repo.slice(repo.indexOf("export async function setTemplateVersionInTx"), repo.indexOf("/** Default settings of a theme version"));
    expect(write).toMatch(/ownerId:\s*ctx\.ownerId/);
    expect(write).toMatch(/templateVersionId:\s*expectedVersionId/);
    expect(write.match(/updateMany\(/g)?.length).toBe(1);
    expect(write).not.toMatch(/page|media|product|storeVersion|publishedVersion|status/i);
  });

  it("the report is computed by the pure compat module (no I/O) and the switch re-evaluates it under the store lock", () => {
    const compat = read("src/modules/pages/compat.ts");
    expect(compat).not.toMatch(/from\s+["'](@\/lib\/db|@prisma\/client)["']/);
    expect(compat).not.toMatch(WRITE_CALL);
    const sw = read("src/modules/stores/theme-switch.ts");
    const body = sw.slice(sw.indexOf("export async function switchTheme"));
    expect(body).toMatch(/computeCompatibility\(/);
    expect(body).toMatch(/expectedDraftRevision \+ 1/);
    expect(body).toMatch(/canSwitch\) throw new ThemeSwitchBlockedError/);
  });

  it("the candidate-theme preview and the preview routes perform no writes and never read published data", () => {
    for (const f of ["src/modules/storefront/service.ts", "src/modules/storefront/repository.ts", "src/app/preview/[storeId]/[[...path]]/page.tsx", "src/app/preview/[storeId]/load.ts", "src/app/preview/CandidateBanner.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(WRITE_CALL);
      expect(src, f).not.toMatch(/readPublishedStorefront|publishedVersion|storeVersion/i);
    }
    // the theme comes from a validated key resolved to the latest ACTIVE version that the code also knows
    expect(read("src/modules/storefront/service.ts")).toMatch(/findLatestActiveThemeVersion\(opts\.candidateThemeKey\)/);
  });

  it("media protection scans every place a section can live: active/dormant/invalid sections, archived sections and snapshots", () => {
    const repo = read("src/modules/media/repository.ts");
    const fn = repo.slice(repo.indexOf("export async function isMediaReferenced"), repo.indexOf("export async function setStoreLogoRow"));
    expect(fn).toMatch(/"sections"::text/);
    expect(fn).toMatch(/"legacySections"::text/);
    expect(fn).toMatch(/"snapshot"::text/);
  });

  it("the switch action authenticates first and carries the report's revision from a hidden form field", () => {
    const actions = read("src/app/dashboard/actions.ts");
    expect(actions).toMatch(/export async function switchThemeAction\([^)]*\)[^{]*\{\n\s*const user = await requireUser\(\)/);
    expect(actions).toMatch(/expectedDraftRevision: str\(fd, "expectedDraftRevision"\)/);
  });
});
