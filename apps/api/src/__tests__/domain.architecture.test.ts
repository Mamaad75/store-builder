import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = (root: string) => walk(root).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : `__MISSING__ ${f}`);
const rel = (fs: string[]) => fs.map((f) => f.split(path.sep).join("/")).sort();
/** Production sources only: test helpers (src/test) intentionally create rows directly. */
const prodFiles = () => files("src").filter((f) => !f.split(path.sep).includes("test") && !f.split(path.sep).includes("__tests__"));
const touchesDb = (f: string) => /from\s+["'](?:\.\.?\/)+lib\/db\.js["']/.test(read(f));

describe("architecture guard: tenant data is only reachable through the owner-scoped layer", () => {

  it("only the expected files in each module touch the database", () => {
    expect(rel(files("src/modules/stores").filter(touchesDb))).toEqual([
      "src/modules/stores/mutation.ts",
      "src/modules/stores/repository.ts",
      "src/modules/stores/service.ts",
    ]);
    expect(rel(files("src/modules/products").filter(touchesDb))).toEqual(["src/modules/products/repository.ts"]);
    expect(rel(files("src/modules/categories").filter(touchesDb))).toEqual(["src/modules/categories/infrastructure/prisma-category.repository.ts"]);
  });

  it("phase 3.3: checkout reads Product and ProductVariant rows for status and sellable stock only (prices come from the published snapshot)", () => {
    expect(rel(files("src/modules/checkout").filter(touchesDb))).toEqual(["src/modules/checkout/infrastructure/prisma-checkout.repository.ts"]);
    const repo = read("src/modules/checkout/infrastructure/prisma-checkout.repository.ts");
    const productReads = [...repo.matchAll(/SELECT ([^`]*?) FROM "(Product|ProductVariant)"/g)].map((m) => `${m[2]}: ${m[1]!.replace(/\s+/g, " ")}`);
    expect(productReads.sort()).toEqual([
      'Product: id, status::text AS status, "stockQuantity"',
      'ProductVariant: DISTINCT "productId"',
      'ProductVariant: id, "productId", "stockQuantity"',
    ]);
    expect(repo).not.toMatch(/\b(db|tx)\.(product|productVariant)\./); // no Prisma model access to catalog rows (it would read every column)
    expect(repo).not.toMatch(/(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"(Product|ProductVariant)"/i);
  });

});

describe("architecture guard: catalog writes go through withStoreMutation", () => {
  const catalogRepos = ["src/modules/products/repository.ts", "src/modules/categories/infrastructure/prisma-category.repository.ts"];

  it("product and category rows are only written inside the two catalog repositories", () => {
    const writes = /\.(product|productCategory)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
    const offenders = prodFiles().filter((f) => writes.test(read(f)) && !catalogRepos.includes(f.split(path.sep).join("/")));
    expect(rel(offenders)).toEqual([]);
  });

  it("raw SQL writes to Product rows exist only in the stock ledger and the price writer (D32-1, D32b-1: not draft edits, no store lock)", () => {
    const raw = /(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"Product(Category)?"/i;
    const writers = prodFiles().filter((f) => raw.test(read(f)));
    expect(rel(writers)).toEqual(["src/modules/inventory/infrastructure/prisma-inventory.repository.ts", "src/modules/pricing/infrastructure/prisma-pricing.repository.ts"]);
    // the price writer only ever sets the price column
    const pricing = read("src/modules/pricing/infrastructure/prisma-pricing.repository.ts");
    const priceSets = [...pricing.matchAll(/UPDATE "Product" SET ([^`]*?)\s+WHERE/g)].map((m) => m[1]!);
    expect(priceSets.length).toBeGreaterThanOrEqual(2); // a linked product's price, and the lowest-variant summary
    for (const set of priceSets) expect(set).toMatch(/^"price" = \$\{[\w.]+\}, "updatedAt" = now\(\)$/);
    // and there they only move stockQuantity: never price, name, status or anything else the merchant owns
    const ledger = read("src/modules/inventory/infrastructure/prisma-inventory.repository.ts");
    const sets = [...ledger.matchAll(/UPDATE "Product" SET ([^`]*?)\s+WHERE/g)].map((m) => m[1]!);
    expect(sets.length).toBeGreaterThanOrEqual(2); // take out (reserve) and give back (release)
    for (const set of sets) expect(set).toMatch(/^"stockQuantity" = (LEAST\()?"stockQuantity" [-+] \$\{[\w.]+\}(, \$\{MAX_STOCK\}\))?, "updatedAt" = now\(\)$/);
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
});

describe("architecture guard: media and object storage", () => {
  const inFiles = (re: RegExp) => rel(prodFiles().filter((f) => re.test(read(f))));

  it("the AWS SDK is imported only by the S3 storage implementation", () => {
    expect(inFiles(/from\s+["']@aws-sdk\//)).toEqual(["src/lib/storage/s3.ts"]);
  });

  it("sharp is imported only by the image pipeline, and the pipeline is used only by uploadMedia (and, D35b-1, the receipt entry of media.api.ts)", () => {
    expect(inFiles(/from\s+["']sharp["']/)).toEqual(["src/modules/media/process.ts"]);
    expect(inFiles(/from\s+["'][^"']*\/process(?:\.js)?["']|from\s+["']\.\/process(?:\.js)?["']/).sort()).toEqual(["src/modules/media/media.api.ts", "src/modules/media/service.ts"]);
    expect(read("src/modules/media/service.ts").match(/processImage\(/g)).toHaveLength(1);
  });

  it("S3 configuration (secrets) is read only by the storage config module", () => {
    expect(inFiles(/process\.env\.S3_|source\.S3_/)).toEqual(["src/lib/storage/config.ts"]);
  });

  it("application code depends on the MediaStorage interface: only the storage barrel instantiates the S3 implementation", () => {
    expect(inFiles(/new S3MediaStorage\(/)).toEqual(["src/lib/storage/index.ts"]);
    expect(inFiles(/from\s+["'](?:@\/lib\/storage\/s3|\.\/s3)(?:\.js)?["']/)).toEqual(["src/lib/storage/index.ts"]);
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
    expect(ownerFns).not.toMatch(/\bdb\.(?!js)/); // no direct, un-scoped client in the owner section
  });


  it("the storage URL is built in one place and no hardcoded host is persisted", () => {
    expect(inFiles(/publicBaseUrl\}\/\$\{key\}/)).toEqual(["src/lib/storage/index.ts"]);
    expect(read("prisma/schema.prisma")).not.toMatch(/https?:\/\//);
    expect(read("src/modules/media/repository.ts")).not.toMatch(/https?:\/\//);
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

  it("hiding is guarded by NON_HIDEABLE_PAGES in the service", () => {
    expect(read("src/modules/pages/service.ts")).toMatch(/NON_HIDEABLE_PAGES\.includes\(type\)/);
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


  it("theme definitions are pure (no React, no CSS, no data layer) so server code and scripts can use them", () => {
    for (const f of files("src/templates").filter((x) => /\/definition\.ts$|\/editor\.ts$/.test(x.split(path.sep).join("/")))) {
      expect(read(f), f).not.toMatch(/from\s+["'](react|react-dom|[^"']*\.css|@\/modules|@\/lib\/db|@prisma\/client)/);
    }
    for (const f of ["src/templates/theme-catalog.ts", "src/templates/section-registry.ts", "src/templates/section-parse.ts"]) {
      expect(read(f), f).not.toMatch(/from\s+["'](react|react-dom|[^"']*\.css)/);
    }
  });


  it("dormant handling keeps stored values: edits serialize the stored raw value of every entry", () => {
    const svc = read("src/modules/pages/service.ts");
    expect(svc).toMatch(/serializeEntries\(out\.entries\)/);
    expect(read("../../packages/shared/src/modules/pages/analyze.ts")).toMatch(/raw: item/);
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

});

describe("architecture guard: product specifications and the appliances theme (phase 9C)", () => {
  const inFiles = (re: RegExp, among = prodFiles()) => rel(among.filter((f) => re.test(read(f))));

  it("the specs library is pure and shared (no React, no database, no Prisma)", () => {
    for (const f of ["src/lib/product-specs.ts", "src/lib/spec-presets.ts"]) {
      expect(read(f), f).not.toMatch(/from\s+["'](react|react-dom|@prisma\/client|@\/lib\/db|@\/modules\/[^"']*)["']/);
    }
  });

  it("specs are written to the product row only from the products service (explicit patch) and its create path", () => {
    expect(inFiles(/c\.specs\s*=|specs:\s*data\.specs/)).toEqual(["src/modules/products/service.ts"]);
    const svc = read("src/modules/products/service.ts");
    // the update path writes specs ONLY when the patch carries them and they differ: unrelated edits never touch stored specs
    expect(svc).toMatch(/if \(patch\.specs !== undefined && !specsUnchanged\(cur\.specs, patch\.specs\)\) c\.specs = patch\.specs;/);
    // every other product write (status, image, delete) names its columns explicitly
    const repo = read("src/modules/products/repository.ts");
    expect(repo.slice(repo.indexOf("export async function setStatusRow"))).not.toMatch(/specs/);
  });


});

describe("architecture guard: the public (store host) path never reads draft data", () => {
  const publicSrc = () => read("src/modules/publishing/public-read.ts");
  // Every table name that appears in a FROM/JOIN of the public read module.
  const tables = (src: string) => [...src.matchAll(/(?:FROM|JOIN)\s+"(\w+)"/gi)].map((m) => m[1]!);

  it("public-read.ts reads only Domain, Store, StoreVersion, StoreVersionProduct, PublishedSlug and LivePrice", () => {
    const used = new Set(tables(publicSrc()));
    expect(used.size).toBeGreaterThan(0);
    // LivePrice (phase 3.2b): the public projection of linked prices, written only by repricing; never a draft table.
    const allowed = new Set(["Domain", "Store", "StoreVersion", "StoreVersionProduct", "PublishedSlug", "LivePrice"]);
    for (const t of used) expect(allowed.has(t), `public path reads table ${t}`).toBe(true);
    // none of the draft tables, by name
    for (const draft of ["Product", "ProductVariant", "PriceLink", "Category", "Page", "PageSection", "Media", "ProductMedia", "StoreSettings", "Theme"]) {
      expect(used.has(draft), draft).toBe(false);
    }
  });

  it("the Store table is read for status and the live pointer only (no draft columns)", () => {
    const m = [...publicSrc().matchAll(/s\."(\w+)"/g)].map((x) => x[1]!);
    const draftColumns = ["name", "description", "draftRevision", "settings", "themeKey", "themeVersion"];
    for (const c of draftColumns) expect(m.includes(c), `Store.${c}`).toBe(false);
  });

  it("the store-host page and public-read import no dashboard, draft repository or owner-scoped module", () => {
    const pageSrc = read("src/app/store-host/[label]/[[...path]]/page.tsx");
    for (const src of [pageSrc, publicSrc()]) {
      expect(src).not.toMatch(/from\s+["']@\/modules\/(stores|products|categories|pages|media|storefront)\b/);
      expect(src).not.toMatch(/from\s+["']@\/app\/dashboard/);
      expect(src).not.toMatch(/requireUser|getStorefront|DraftStorefrontRepository/);
    }
  });

  it("only the raw Host header is read for routing; forwarded host headers are never read anywhere in src", () => {
    const offenders = prodFiles().filter((f) => /x-forwarded-host|x-original-host|"forwarded"/i.test(read(f).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")));
    expect(rel(offenders)).toEqual([]);
  });

  it("the internal /store-host namespace is only produced by the proxy rewrite (never linked from application code)", () => {
    const offenders = prodFiles().filter((f) => /store-host/.test(read(f)) && !/(proxy\.ts|store-routing\.ts|store-host\/\[label\])/.test(f));
    expect(rel(offenders)).toEqual([]);
  });

  it("publishing writes immutable tables only by INSERT (no UPDATE/DELETE of versions or the per-version index in application code)", () => {
    for (const f of prodFiles()) {
      const src = read(f);
      expect(src, f).not.toMatch(/UPDATE\s+"(StoreVersion|StoreVersionProduct|PublishedSlug)"/i);
      expect(src, f).not.toMatch(/DELETE\s+FROM\s+"(StoreVersion|StoreVersionProduct|PublishedSlug)"/i);
      expect(src, f).not.toMatch(/\.(storeVersion|storeVersionProduct|publishedSlug)\.(update|updateMany|delete|deleteMany|upsert)\(/);
    }
  });
});


describe("architecture guard: draft writers are bounded by the draft lock timeout", () => {
  const mutation = () => read("src/modules/stores/mutation.ts");

  it("withStoreMutation arms lock_timeout BEFORE it touches the store row, and maps 55P03 to the typed error", () => {
    const src = mutation();
    const fn = src.slice(src.indexOf("export async function withStoreMutation"), src.indexOf("declare const lockBrand"));
    expect(fn.indexOf("armDraftLockTimeout(tx)")).toBeGreaterThan(-1);
    expect(fn.indexOf("armDraftLockTimeout(tx)")).toBeLessThan(fn.indexOf("tx.store.updateMany"));
    expect(fn).toMatch(/throw mapDraftLockTimeout\(e\)/);
    expect(src).toMatch(/pgErrorCode\(e\) === "55P03" \? new DraftBusyError\(\)/);
    expect(src).toMatch(/DRAFT_LOCK_TIMEOUT_MS = 5_000/);
  });

  it("publishing keeps its own lock behavior: withStoreLock still uses its own lockTimeoutMs and StoreLockBusyError, not the draft timeout", () => {
    const src = mutation();
    const lock = src.slice(src.indexOf("export async function withStoreLock"));
    expect(lock).toMatch(/opts\.lockTimeoutMs \?\? 5_000/);
    expect(lock).toMatch(/StoreLockBusyError/);
    expect(lock).not.toMatch(/armDraftLockTimeout|DraftBusyError|draftLockTimeoutMs/);
  });

  it("the test seam for the draft timeout is never used by production code", () => {
    const users = prodFiles().filter((f) => /setDraftLockTimeoutForTests/.test(read(f)));
    expect(rel(users)).toEqual(["src/modules/stores/mutation.ts"]);
  });
});

describe("architecture guard: media release after a committed change never fails it and is never silent", () => {
  it("releaseMedia is called only inside the media service; every other caller uses the never-throwing, logging variant", () => {
    const callers = prodFiles().filter((f) => /\breleaseMedia\(/.test(read(f)));
    expect(rel(callers)).toEqual(["src/modules/media/service.ts"]);
    for (const f of ["src/modules/products/service.ts", "src/modules/pages/service.ts", "src/modules/media/orchestration.ts"]) {
      expect(read(f), f).toMatch(/releaseMediaBestEffort\(/);
    }
  });

  it("nothing swallows a release silently (no `.catch(() => undefined)` on a release)", () => {
    for (const f of prodFiles()) expect(read(f), f).not.toMatch(/release\w*\([^)]*\)\s*\.catch\(\s*\(\)\s*=>\s*undefined\s*\)/);
  });

  it("the best-effort release logs one structured event and the cleanup reclaims through the lock-only (no draftRevision bump) path", () => {
    const svc = read("src/modules/media/service.ts");
    expect(svc).toMatch(/event: "media\.release_failed"/);
    expect(svc).toMatch(/const inLock: RunLocked = async \(ownerId, storeId, fn\) => \(await withStoreLock\(/);
    expect(read("src/modules/media/cleanup.ts")).toMatch(/reclaimMedia\(/);
    expect(read("src/modules/media/cleanup.ts")).not.toMatch(/\breleaseMedia\(/);
  });

  it("the cleanup script reports failures through its exit code", () => {
    expect(read("scripts/cleanup-media.ts")).toMatch(/failures > 0\) process\.exitCode = 2/);
  });

  it("business-category changes and store deletion go through the draft lock timeout", () => {
    const repo = read("src/modules/stores/repository.ts");
    const cat = repo.slice(repo.indexOf("async setBusinessCategory"), repo.indexOf("async updateDraft") > 0 ? repo.indexOf("/** Optimistic update") : undefined);
    expect(cat).toMatch(/withDraftLockTimeout\(this\.client/);
    const del = repo.slice(repo.indexOf("async deleteConfirmed"));
    expect(del).toMatch(/withDraftLockTimeout\(this\.client/);
    // no other Store write exists outside withStoreMutation / the publishing lock / these timeout-wrapped writers
    const offenders = prodFiles().filter((f) => /store\.(update|updateMany|delete|deleteMany)\(/.test(read(f)));
    expect(rel(offenders)).toEqual(["src/modules/media/repository.ts", "src/modules/publishing/repository.ts", "src/modules/stores/mutation.ts", "src/modules/stores/repository.ts"]);
  });
});


describe("architecture guard: authentication lives in the NestJS API (ADR 0001, N3)", () => {
  it("server-action files export only actions (helpers such as cookie application would otherwise become client-callable endpoints)", () => {
    for (const f of ["src/app/actions-auth.ts", "src/app/dashboard/account/actions.ts"]) {
      const exported = [...read(f).matchAll(/^export (?!async function)(?!interface)(?!type)(\w+)/gm)];
      expect(exported.map((m) => m[0]), f).toEqual([]);
      const names = [...read(f).matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
      expect(names.every((n) => /Action$/.test(n!)), `${f}: ${names.join(",")}`).toBe(true);
    }
  });
});




describe("architecture guard: published snapshot shape (SEO, phase 11)", () => {
  it("the new snapshot field stays optional without a default (no content-hash change for stores that never set it)", () => {
    expect(read("../../packages/shared/src/templates/storefront-data.ts")).toMatch(/description: z\.string\(\)\.max\(160\)\.optional\(\)/);
    expect(read("src/modules/storefront/build.ts")).toMatch(/\.\.\.\(resolved\.description \? \{ description: resolved\.description \} : \{\}\)/);
  });
});

describe("architecture guard: the database belongs to the API", () => {
  it("the Prisma client is imported (as a value) only under database/ and by the files that need the runtime namespace", () => {
    const values = prodFiles().filter((f) => /^import\s+(?!type)[^;]*from\s+["']@prisma\/client["']/m.test(read(f)));
    expect(rel(values)).toEqual([]); // @prisma/client is CommonJS: values come through database/prisma-runtime.ts and database/prisma-client.ts
  });
  it("the user record carries a unique username (U1)", () => {
    expect(read("prisma/schema.prisma")).toMatch(/username\s+String\s+@unique/);
  });
});
