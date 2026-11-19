import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getDbUrls } from "@/test/db-url";

/**
 * The Phase 10 migration against LEGACY data in a scratch database (never the shared test database): it must succeed on
 * consistent data and fail loudly - changing nothing - on inconsistent data (decision U11).
 */
const PHASE10 = "20261112090000_phase10_publishing";
const dir = path.resolve("prisma/migrations");
const migrations = readdirSync(dir).filter((d) => /^\d{14}_/.test(d)).sort();
const before = migrations.filter((m) => m < PHASE10);
expect(migrations.includes(PHASE10)).toBe(true);

const admin = getDbUrls().admin;
const scratchName = "storebuilder_migrate_scratch_test";
const scratchUrl = (() => {
  const u = new URL(admin);
  u.pathname = `/${scratchName}`;
  return u.toString();
})();

function psql(url: string, args: string[], input?: string): string {
  const u = new URL(url);
  return execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-h", u.hostname, "-p", u.port || "5432", "-U", decodeURIComponent(u.username), "-d", u.pathname.slice(1), ...args], {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) },
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
const sql = (q: string) => psql(scratchUrl, ["-c", q]).trim();
const applyFile = (name: string) => psql(scratchUrl, ["-f", path.join(dir, name, "migration.sql")]);

const adminDb = new PrismaClient({ datasources: { db: { url: admin } } });

async function freshLegacyDb() {
  await adminDb.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
  await adminDb.$executeRawUnsafe(`CREATE DATABASE "${scratchName}"`);
  for (const m of before) applyFile(m);
  sql(`INSERT INTO "User"(id,email,name,"passwordHash","updatedAt") VALUES ('u1','u1@example.com','n','h',now())`);
  sql(`INSERT INTO "Template"(id,key,name) VALUES ('t1','default','Default')`);
  sql(`INSERT INTO "TemplateVersion"(id,"templateId",version,"defaultSettings","defaultPages") VALUES ('tv1','t1',1,'{}','[]')`);
  sql(`INSERT INTO "Store"(id,"ownerId","templateVersionId",name,settings,"updatedAt") VALUES ('s1','u1','tv1','S1','{}',now()),('s2','u1','tv1','S2','{}',now())`);
}

const columnExists = (table: string, col: string) =>
  sql(`SELECT count(*) FROM information_schema.columns WHERE table_name='${table}' AND column_name='${col}'`) === "1";
const tableExists = (t: string) => sql(`SELECT count(*) FROM information_schema.tables WHERE table_name='${t}'`) === "1";

afterAll(async () => {
  await adminDb.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
  await adminDb.$disconnect();
});

describe("Phase 10 migration on legacy data", () => {
  beforeEach(freshLegacyDb, 120_000);

  it("succeeds on consistent legacy rows and keeps them (a legacy version gets an empty hash and size)", () => {
    sql(`INSERT INTO "StoreVersion"(id,"storeId",number,"draftRevision",snapshot) VALUES ('v1','s1',1,1,'{"legacy":true}')`);
    sql(`INSERT INTO "Domain"(id,"storeId",kind,host) VALUES ('d1','s1','SUBDOMAIN','coffee')`);
    applyFile(PHASE10);
    expect(sql(`SELECT "contentHash" || '|' || "snapshotBytes" FROM "StoreVersion" WHERE id='v1'`)).toBe("|0");
    expect(sql(`SELECT host FROM "Domain" WHERE id='d1'`)).toBe("coffee");
    expect(tableExists("SubdomainReservation")).toBe(true);
    expect(tableExists("PublishedSlug")).toBe(true);
    expect(tableExists("StoreVersionProduct")).toBe(true);
  }, 120_000);

  const inconsistent: [string, string, RegExp][] = [
    ["a store with two subdomains", `INSERT INTO "Domain"(id,"storeId",kind,host) VALUES ('d1','s1','SUBDOMAIN','coffee'),('d2','s1','SUBDOMAIN','tea')`, /more than one subdomain: 1/],
    ["an upper-case subdomain", `INSERT INTO "Domain"(id,"storeId",kind,host) VALUES ('d1','s1','SUBDOMAIN','Coffee')`, /malformed subdomain rows: 1/],
    ["a one-character subdomain", `INSERT INTO "Domain"(id,"storeId",kind,host) VALUES ('d1','s1','SUBDOMAIN','a')`, /malformed subdomain rows: 1/],
    ["a version numbered 0", `INSERT INTO "StoreVersion"(id,"storeId",number,"draftRevision",snapshot) VALUES ('v0','s1',0,1,'{}')`, /below 1: 1/],
  ];
  it.each(inconsistent)("aborts loudly and changes nothing for %s", (_name, seed, message) => {
    // The init migration already forbids some of these states; drop that guard in the scratch DB so the pre-flight itself is exercised.
    sql(`DROP INDEX IF EXISTS "Domain_one_subdomain_per_store"`);
    sql(seed);
    let error = "";
    try {
      applyFile(PHASE10);
    } catch (e) {
      error = String((e as { stderr?: unknown }).stderr ?? e);
    }
    expect(error).toMatch(/Phase 10 migration aborted/);
    expect(error).toMatch(message);
    // The pre-flight runs first and the file is one failed script: no new column or table exists.
    expect(columnExists("StoreVersion", "contentHash")).toBe(false);
    expect(tableExists("SubdomainReservation")).toBe(false);
    expect(tableExists("PublishedSlug")).toBe(false);
  }, 120_000);

  it("aborts for a store whose status and live pointer disagree (checked by pre-flight even if the init constraint were absent)", () => {
    sql(`ALTER TABLE "Store" DROP CONSTRAINT "Store_published_consistency"`);
    sql(`UPDATE "Store" SET status='PUBLISHED' WHERE id='s1'`);
    let error = "";
    try {
      applyFile(PHASE10);
    } catch (e) {
      error = String((e as { stderr?: unknown }).stderr ?? e);
    }
    expect(error).toMatch(/Phase 10 migration aborted/);
    expect(error).toMatch(/disagree: 1/);
    expect(tableExists("PublishedSlug")).toBe(false);
  }, 120_000);
});
