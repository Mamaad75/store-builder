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
const prodFiles = () => files("src").filter((f) => !f.split(path.sep).includes("test"));

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
    const proxy = read("src/proxy.ts");
    // Phase 10: the proxy matcher is catch-all (host routing needs every request); /preview is still gated by the session check on the platform host.
    expect(proxy).toMatch(/startsWith\("\/preview"\)\)\s*return\s*requireSession/);
    expect(proxy).toMatch(/matcher:\s*\["\/\(\(\?!_next\/static/);
    const cfg = read("next.config.ts");
    expect(cfg).toMatch(/\/preview\/:path\*/);
    expect(cfg).toMatch(/X-Robots-Tag/);
    expect(cfg).toMatch(/no-store/);
  });
});

describe("architecture guard: media and object storage", () => {




  it("templates never import the storage client: only the pure key format", () => {
    const offenders = files("src/templates").filter((f) => /from\s+["']@\/lib\/storage(?!\/keys)/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("media upload actions authenticate first and Server Action bodies are capped", () => {
    // identity comes from the API session (requireUser) and the upload goes through the gateway; the client supplies nothing but the bytes
    const media = read("src/app/dashboard/media-actions.ts");
    expect(media).toMatch(/await requireUser\(\)/);
    expect(media).toMatch(/uploadProductImage\(storeId, productId, bytes\)/);
    expect(media).toMatch(/uploadStoreLogo\(storeId, bytes\)/);
    expect(media).toMatch(/uploadSectionImage\(storeId, pageType, sectionId/);
    expect(media).not.toMatch(/ownerId|userId/);
    expect(read("next.config.ts")).toMatch(/bodySizeLimit:\s*"6mb"/);
  });
});

describe("architecture guard: page editing (draft only, owner-scoped, template-aware)", () => {
  const inFiles = (re: RegExp) => rel(prodFiles().filter((f) => re.test(read(f))));

  it("the editing service names no concrete template: approved sections come from the template's editor spec", () => {
    const offenders = files("src/modules/pages").filter((f) => /["'](general|coffee|fashion)["']/.test(read(f)));
    expect(offenders).toEqual([]);
    expect(read("src/templates/types.ts")).toMatch(/readonly editor: EditorSpec/);
  });

  it("no raw HTML injection and no external fonts/stylesheets anywhere in the app or templates", () => {
    // The single exception (phase 11): JSON-LD blocks need raw script content (React would entity-escape the JSON quotes). The
    // allow-list is exactly one file, and it must serialise through the escaping `serializeJsonLd` (see the SEO guards below).
    expect(inFiles(/dangerouslySetInnerHTML/)).toEqual(["src/app/store-host/[label]/JsonLd.tsx"]);
    expect(inFiles(/@import\s+url\(|fonts\.googleapis|fonts\.gstatic|<link[^>]+stylesheet/)).toEqual([]);
    expect(read("src/templates/general/general.module.css")).not.toMatch(/@import|url\(\s*["']?https?:/);
  });

  it("the page editor actions authenticate first and the editing UI imports no data layer", () => {
    expect(read("src/app/dashboard/pages-actions.ts")).toMatch(/export async function pageEditAction\([^)]*\)[^{]*\{\n\s*await requireUser\(\)/);
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
    expect(inFiles(/from\s+["']\.\/(general|coffee|fashion)\/definition(?:\.js)?["']/, files("../../packages/shared/src/templates"))).toEqual(["../../packages/shared/src/templates/theme-catalog.ts"]);
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
    expect(inFiles(/from\s+["']@\/templates\/registry["']/, [...files("src/app/dashboard"), ...files("src/components"), ...files("../../packages/shared/src/")])).toEqual([]);
    const reg = read("../../packages/shared/src/templates/section-registry.ts");
    expect(reg).toMatch(/startsWith\(`\$\{theme\.key\}\.`\)/);
  });

});

describe("architecture guard: theme switching and candidate preview (phase 9B)", () => {

  it("the switch action authenticates first and carries the report's revision from a hidden form field", () => {
    const actions = read("src/app/dashboard/actions.ts");
    expect(actions).toMatch(/export async function switchThemeAction\([^)]*\)[^{]*\{\n\s*await requireUser\(\)/);
    expect(actions).toMatch(/expectedDraftRevision: str\(fd, "expectedDraftRevision"\)/);
  });
});

describe("architecture guard: product specifications and the appliances theme (phase 9C)", () => {
  const inFiles = (re: RegExp, among = prodFiles()) => rel(among.filter((f) => re.test(read(f))));

  it("the specs library is pure and shared (no React, no database, no Prisma)", () => {
    for (const f of ["src/lib/product-specs.ts", "src/lib/spec-presets.ts"]) {
      expect(read(f), f).not.toMatch(/from\s+["'](react|react-dom|@prisma\/client|@\/lib\/db|@\/modules\/[^"']*)["']/);
    }
  });

  it("the product form sends specs only for the explicit 'replace' and 'clear' intents", () => {
    const f = read("../../packages/shared/src/modules/products/specs-form.ts");
    expect(f).toMatch(/intent === "clear"\) return \[\]/);
    expect(f).toMatch(/intent !== "replace"\) return undefined/);
    expect(read("src/app/dashboard/catalog-actions.ts")).toMatch(/specs: specsFromForm\(fd\)/);
  });

  it("every theme renders specs through the shared escaping components: ProductSpecs on the detail page and CardSpecs on cards", () => {
    for (const theme of ["general", "coffee", "fashion", "appliances"]) {
      const src = files(`src/templates/${theme}`).map((f) => read(f)).join("\n");
      expect(src, theme).toMatch(/<ProductSpecs\b/);
      expect(src, theme).toMatch(/<CardSpecs\b/);
      expect(src, theme).not.toMatch(/dangerouslySetInnerHTML/);
    }
    const engine = read("src/templates/engine/Specs.tsx");
    expect(engine).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    expect(engine).toMatch(/cardSpecs\(specs\)/); // the two-row rule lives in one place
  });

  it("no template or dashboard source injects raw HTML", () => {
    // Only the JSON-LD component (phase 11, escaped by serializeJsonLd) may use raw markup; never a template, component or dashboard file.
    expect(inFiles(/dangerouslySetInnerHTML/, [...files("src/templates"), ...files("src/components"), ...files("src/app")])).toEqual(["src/app/store-host/[label]/JsonLd.tsx"]);
  });

  it("the appliances theme is registered in the catalog, the module registry and the seed definitions (and nowhere is a theme key hardcoded in the engine)", () => {
    expect(read("../../packages/shared/src/templates/theme-catalog.ts")).toMatch(/appliancesTheme/);
    expect(read("src/templates/registry.ts")).toMatch(/appliancesTemplate/);
    expect(read("../../packages/shared/src/templates/definitions.ts")).toMatch(/key: "appliances"/);
    expect(inFiles(/appliances/, files("src/templates/engine"))).toEqual([]);
  });

  it("the snapshot budget constants are derived from real validators in a test (docs and code cannot drift)", () => {
    expect(read("src/lib/product-specs.size.test.ts")).toMatch(/SPECS_WORST_CASE_JSON_BYTES_PER_PRODUCT/);
  });
});

describe("architecture guard: the public (store host) path never reads draft data", () => {
  const publicSrc = () => read("src/modules/publishing/public-read.ts");
  // Every table name that appears in a FROM/JOIN of the public read module.

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

describe("architecture guard: host validation is enforced by the application (unknown hosts are never the platform)", () => {
  it("the proxy builds its decision from getHostPolicy() and answers not_found with the neutral 404", () => {
    const proxy = read("src/proxy.ts");
    expect(proxy).toMatch(/getHostPolicy\(\)/);
    expect(proxy).toMatch(/decideRoute\(.*policy\.rootDomain,\s*policy\.aliases\)/);
    expect(proxy).toMatch(/decision\.kind === "not_found"\)\s*return neutralNotFound/);
  });

  it("decideRoute rejects unknown hosts before anything else", () => {
    expect(read("../../packages/shared/src/lib/store-routing.ts")).toMatch(/host\.kind === "unknown"\)\s*return \{ kind: "not_found" \}/);
  });

  it("loopback aliases exist only for an explicit development or test environment (production, staging and unset are strict)", () => {
    const src = read("../../packages/shared/src/lib/hostname.ts");
    expect(src).toMatch(/nodeEnv !== "development" && nodeEnv !== "test"\)\s*return \[\]/);
    expect(src).not.toMatch(/NODE_ENV/); // hostname.ts is pure: the environment is passed in
  });

  it("NODE_ENV is read for host policy in exactly one place, and nothing else passes aliases to the resolver", () => {
    const readers = [...prodFiles(), ...files("../../packages/shared/src/")].filter((f) => /NODE_ENV/.test(read(f)) && /platformAliases|host-policy|aliases/.test(read(f)));
    expect(rel(readers)).toEqual(["src/lib/host-policy.ts"]);
    const callers = [...prodFiles(), ...files("../../packages/shared/src/")].filter((f) => /resolveHost\([^\n]*aliases/i.test(read(f)));
    expect(rel(callers)).toEqual(["../../packages/shared/src/lib/hostname.ts", "../../packages/shared/src/lib/store-routing.ts", "src/lib/host-guard.ts"]); // hostname.ts is the definition itself
  });

  it("the platform-only guards require a recognised platform host (not merely 'not a store host')", () => {
    const guard = read("src/lib/host-guard.ts");
    expect(guard).toMatch(/kind === "platform"/);
    expect(guard).toMatch(/if \(!isPlatformHostHeader\(/);
    expect(guard).not.toMatch(/isStoreHostHeader/);
    for (const f of [
      "src/app/dashboard/layout.tsx",
      "src/app/preview/[storeId]/layout.tsx",
      "src/app/(auth)/layout.tsx",
      "src/app/api/health/route.ts",
    ]) {
      expect(read(f), f).toMatch(/assertPlatformHost\(\)|platformOnly\(/);
    }
  });
});

describe("architecture guard: draft writers are bounded by the draft lock timeout", () => {

  it("every dashboard action module that runs draft mutations maps DraftBusyError to the owner-facing message or notice", () => {
    for (const f of ["src/app/dashboard/actions.ts", "src/app/dashboard/catalog-actions.ts", "src/app/dashboard/pages-actions.ts", "src/app/dashboard/media-actions.ts"]) {
      expect(read(f), f).toMatch(/instanceof DraftBusyError/);
    }
  });
});

describe("architecture guard: media release after a committed change never fails it and is never silent", () => {

  it("nothing swallows a release silently (no `.catch(() => undefined)` on a release)", () => {
    for (const f of prodFiles()) expect(read(f), f).not.toMatch(/release\w*\([^)]*\)\s*\.catch\(\s*\(\)\s*=>\s*undefined\s*\)/);
  });
});

describe("architecture guard: SEO (phase 11) reads only published data and never trusts request headers for identity", () => {


  it("the JSON-LD component serialises only through serializeJsonLd, and the serializer escapes the tag-closing characters", () => {
    const comp = read("src/app/store-host/[label]/JsonLd.tsx");
    expect(comp).toMatch(/__html: serializeJsonLd\(item\)/);
    expect(comp.match(/dangerouslySetInnerHTML=/g)).toHaveLength(1); // one attribute, nothing else
    const ser = read("../../packages/shared/src/seo/jsonld.ts");
    for (const ch of ["u003c", "u003e", "u0026", "u2028", "u2029"]) expect(ser).toContain(ch);
  });

  it("every public SEO route (page metadata, robots.txt, sitemap.xml) uses the shared host check and the published-store loader", () => {
    for (const f of [
      "src/app/store-host/[label]/[[...path]]/page.tsx",
      "src/app/store-host/[label]/robots.txt/route.ts",
      "src/app/store-host/[label]/sitemap.xml/route.ts",
    ]) {
      const src = read(f);
      expect(src, f).toMatch(/hostNamesLabel\(/);
      expect(src, f).toMatch(/loadPublicStore\(/);
      expect(src, f).not.toMatch(/x-forwarded|forwarded-host|\.get\(["']host["']\)/i);
    }
    const shared = read("src/app/store-host/[label]/_public.ts");
    expect(shared).toMatch(/publicStoreUrl\(label\)/); // the public base URL comes from configuration
    expect(shared).toMatch(/resolveHost\(\(await headers\(\)\)\.get\("host"\)/); // the raw Host header only
  });

  it("the platform robots.txt blocks the application and nothing else is indexable by accident", () => {
    const src = read("src/app/robots.ts");
    for (const p of ["/dashboard", "/preview", "/api/"]) expect(src).toContain(`"${p}"`);
    // login/register must stay crawlable so that their noindex directive can be read
    for (const p of ["/login", "/register"]) expect(src).not.toContain(`"${p}"`);
    for (const f of ["src/app/(auth)/login/page.tsx", "src/app/(auth)/register/page.tsx"]) {
      expect(read(f), f).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
    }
    for (const f of ["src/app/dashboard/layout.tsx", "src/app/preview/[storeId]/[[...path]]/page.tsx"]) {
      expect(read(f), f).toMatch(/robots:\s*\{\s*index:\s*false/);
    }
  });

  it("the new snapshot field stays optional without a default (no content-hash change for stores that never set it)", () => {
    expect(read("../../packages/shared/src/templates/storefront-data.ts")).toMatch(/description: z\.string\(\)\.max\(160\)\.optional\(\)/);
  });

  it("phase 12: the account area is guarded, tokens are never logged or stored raw, and no mail provider SDK exists", () => {
    // every account action authenticates first (the generic dashboard-actions guard also covers it)
    const acct = read("src/app/dashboard/account/actions.ts");
    expect(acct.startsWith('"use server"')).toBe(true);
    for (const m of acct.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)/g)) expect(m[2], m[1]).toMatch(/requireUser\(\)/);
    // account code never logs credentials or identities
    expect(acct).not.toMatch(/console\.\w+\(/);
    // public auth pages carrying credentials are never indexed
    for (const f of ["src/app/(auth)/login/page.tsx", "src/app/(auth)/register/page.tsx"]) expect(read(f), f).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
    // Mail goes out only through the provider-neutral SMTP transport (DM2-1, superseding the "no transport" part of D12-2):
    // exactly one mail library, pinned to an exact version, and no provider SDK (SES/SendGrid/... would tie the code to a vendor).
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    const mailDeps = Object.keys(pkg.dependencies).filter((d) => /nodemailer|sendgrid|mailgun|postmark|resend|@aws-sdk\/client-ses|smtp/i.test(d));
    expect(mailDeps).toEqual(["nodemailer"]);
    expect(pkg.dependencies.nodemailer).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("phase 12: error boundaries never render the error message or stack, and legal pages are platform-only", () => {
    for (const f of ["src/app/error.tsx", "src/app/global-error.tsx"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/error\.(message|stack)/);
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML/);
    }
    expect(read("src/app/(legal)/layout.tsx")).toMatch(/await assertPlatformHost\(\)/);
    // the dashboard layout keeps a skip link (the shared SkipLink component since the M3 audit) and a main landmark
    const layout = read("src/app/dashboard/layout.tsx");
    expect(layout).toContain("<SkipLink />");
    expect(read("src/components/SkipLink.tsx")).toContain('href="#main"');
    expect(layout).toMatch(/component="main"\s+id="main"/);
  });

  it("phase 12 mail guard: log/file transports are refused in production at start-up and again in createMailer, and the override is E2E-only", () => {
    const mailer = read("src/modules/auth/mailer.ts");
    expect(mailer).toMatch(/export function assertMailTransportAllowed/);
    expect(mailer).toMatch(/export function createMailer[^{]*\{\s*assertMailTransportAllowed\(env\)/);
    // the production mailer ("none") has no console output at all; only the dev log transport prints messages
    expect([...mailer.matchAll(/console\.\w+/g)].map((m) => m[0]).sort()).toEqual(["console.error", "console.info", "console.warn"]);
    expect(mailer).toMatch(/console\.warn\("\[mail\] WARNING: [^"$`]*"\)/); // a fixed string: nothing interpolated
    // start-up refusal
    const inst = read("src/instrumentation.ts");
    expect(inst).toMatch(/NEXT_RUNTIME !== "nodejs"/);
    expect(inst).toMatch(/enforceMailTransportAtStartup\(process\.env\)/);
    // the override name appears only in the guard and the E2E config (tests and docs aside): never in app code, scripts, CI or env examples
    const holders = [...prodFiles(), ...files("../e2e/e2e"), ...files("scripts"), "../e2e/playwright.config.ts", "../../.github/workflows/ci.yml", ".env.example"]
      .filter((f) => { try { return /MAIL_E2E_FILE_OUTBOX_OVERRIDE/.test(read(f)); } catch { return false; } });
    expect(rel(holders).sort()).toEqual(["../e2e/playwright.config.ts", "src/modules/auth/mailer.ts"]);
    // CI and examples never turn on log/file for a production start
    for (const f of ["../../.github/workflows/ci.yml", ".env.example"]) expect(read(f), f).not.toMatch(/^[^#\n]*MAIL_TRANSPORT\s*[:=]\s*["']?(log|file)/im); // commented examples are fine
  });

  it("U1 (ADR 0001): sign-in is by username; e-mail and password reset are gone from every production path", () => {
    // nothing reads or writes the deprecated reset-token table (it is dropped by the approved contract migration later)
    const holders = prodFiles().filter((f) => /\.passwordResetToken\b|(INTO|FROM|UPDATE|JOIN)\s+"PasswordResetToken"/.test(read(f)));
    expect(rel(holders)).toEqual([]);
    // no reset routes, no reset actions
    for (const p of ["src/app/(auth)/forgot-password/page.tsx", "src/app/(auth)/reset-password/page.tsx"]) expect(existsSyncSafe(p), p).toBe(false);
    const actions = read("src/app/actions-auth.ts");
    expect(actions).not.toMatch(/forgotPassword|resetPassword|requestPasswordReset/);
    // the credentials are username + password, end to end
    expect(actions).toMatch(/"\/api\/auth\/login"[\s\S]*username: formData\.get\("username"\)/);
    expect(actions).toMatch(/username: formData\.get\("username"\)/);
    expect(read("src/components/AuthForm.tsx")).toMatch(/name="username"/);
    expect(read("src/components/AuthForm.tsx")).not.toMatch(/name="email"/);
    // the user record carries a unique username; e-mail is optional and never selected for callers
    expect(read("../api/prisma/schema.prisma")).toMatch(/username\s+String\s+@unique/);
  });
});

describe("architecture guard: authentication lives in the NestJS API (ADR 0001, N3)", () => {
  it("the web app has no credential, token or session-signing code of its own", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    for (const dep of ["next-auth", "@auth/core", "@node-rs/argon2", "argon2", "bcrypt", "bcryptjs", "jose", "jsonwebtoken"]) expect(pkg.dependencies[dep], dep).toBeUndefined();
    const offenders = prodFiles().filter((f) => /from\s+["'](next-auth|@auth\/|jose|jsonwebtoken|@node-rs\/argon2)/.test(read(f)) || /AUTH_SECRET/.test(read(f)));
    expect(rel(offenders)).toEqual([]);
    for (const p of ["src/app/api/auth", "src/modules/auth/password.ts", "src/modules/auth/callbacks.ts", "src/modules/auth/account.ts"]) expect(existsSyncSafe(p), p).toBe(false);
  });
  it("the session is read only through auth() (a request to the API) and set only from the API's own Set-Cookie", () => {
    const a = read("src/auth.ts");
    expect(a).toMatch(/callApi<[^>]*>\("GET", "\/api\/auth\/me"/);
    expect(read("src/lib/session-bff.ts")).toMatch(/SESSION_COOKIE_NAMES as readonly string\[\]\)\.includes\(c\.name\)/); // nothing but the session cookie is ever applied
    const setters = prodFiles().filter((f) => /cookies\(\)[\s\S]*\.set\(|jar\.set\(/.test(read(f)));
    expect(rel(setters)).toEqual(["src/lib/session-bff.ts"]);
  });
  it("server-action files export only actions (helpers such as cookie application would otherwise become client-callable endpoints)", () => {
    for (const f of ["src/app/actions-auth.ts", "src/app/dashboard/account/actions.ts"]) {
      const exported = [...read(f).matchAll(/^export (?!async function)(?!interface)(?!type)(\w+)/gm)];
      expect(exported.map((m) => m[0]), f).toEqual([]);
      const names = [...read(f).matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
      expect(names.every((n) => /Action$/.test(n!)), `${f}: ${names.join(",")}`).toBe(true);
    }
  });
  it("every call to the API goes through api-client (fixed base URL and the platform Origin)", () => {
    const direct = prodFiles().filter((f) => /INTERNAL_API_URL/.test(read(f)) && !["src/lib/api-client.ts", "src/lib/server-env.ts"].includes(rel([f])[0]!));
    expect(rel(direct)).toEqual([]);
    expect(read("src/lib/api-client.ts")).toMatch(/origin: platformOrigin\(\)/);
  });
});

describe("architecture guard: outgoing mail (MVP step M2, decision DM2-1)", () => {
  it("nodemailer is imported only by the SMTP transport module", () => {
    const importers = prodFiles().filter((f) => /from\s+["']nodemailer["']/.test(read(f)));
    expect(rel(importers)).toEqual(["src/modules/auth/smtp.ts"]);
  });
  it("the SMTP transport can never disable certificate verification or fall back to plain text", () => {
    const smtp = read(path.join("src", "modules", "auth", "smtp.ts"));
    expect(smtp).toContain("rejectUnauthorized: true");
    expect(smtp).toContain("requireTLS: !cfg.secure");
    expect(smtp).toContain("ignoreTLS: false");
    expect(smtp).not.toMatch(/rejectUnauthorized:\s*(false|!|cfg\.|env\.)/);
  });
});



function existsSyncSafe(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
