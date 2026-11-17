import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeUser, prisma, resetDb } from "@/test/db-helpers";

/** Real pg_dump / pg_restore against the isolated test database (the backup and restore drill of docs/runbook.md). */
const SCRIPTS = path.resolve(import.meta.dirname, "../../scripts");
const URL_ = process.env.DATABASE_URL!;
const scratchUrl = (name: string) => URL_.replace(/\/[^/?]+(\?.*)?$/, `/${name}$1`);
let dir: string;
const run = (script: string, args: string[], env: Record<string, string>) =>
  spawnSync("bash", [path.join(SCRIPTS, script), ...args], { env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 120_000 });
const lines = (out: string) => out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, unknown>);
const dumpOf = () => readdirSync(dir).filter((f) => f.endsWith(".dump")).sort().at(-1)!;

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "backup-test-"));
  await resetDb();
  await makeUser();
  await makeUser();
});
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  for (const n of ["restore_drill_a", "restore_drill_b"]) await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`);
  await prisma.$disconnect();
});

describe("backup.sh and restore.sh", () => {
  it("creates a readable, checksummed dump and logs one JSON line per step, never the password", () => {
    const r = run("backup.sh", [], { DATABASE_URL: URL_, BACKUP_DIR: dir });
    expect(r.status, r.stderr).toBe(0);
    const ev = lines(r.stdout);
    expect(ev.map((e) => e.event)).toEqual(["backup.created", "backup.pruned"]);
    expect(existsSync(path.join(dir, `${dumpOf()}.sha256`))).toBe(true);
    const pw = new URL(URL_).password;
    expect(r.stdout + r.stderr).not.toContain(`:${pw}@`); // (the test password equals the user and database name, so look for the URL form)
    expect(r.stdout + r.stderr).not.toContain("postgresql://");
  });

  it("the dump restores into a NEW database with identical data (the restore drill)", async () => {
    const dump = path.join(dir, dumpOf());
    const target = scratchUrl("restore_drill_a");
    const r = run("restore.sh", [dump], { RESTORE_TARGET_URL: target });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const done = lines(r.stdout).find((e) => e.event === "restore.done")!;
    expect(done.database).toBe("restore_drill_a");
    const live = (await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "User"`))[0]!.n;
    expect(String(done.users_stores_versions).split(",")[0]).toBe(String(live));
    expect(Number(live)).toBe(2);
  });

  it("refuses to overwrite an existing database unless RESTORE_REPLACE=yes, and the refusal changes nothing", () => {
    const dump = path.join(dir, dumpOf());
    const target = scratchUrl("restore_drill_a");
    const refused = run("restore.sh", [dump], { RESTORE_TARGET_URL: target });
    expect(refused.status).toBe(1);
    expect(lines(refused.stdout).at(-1)).toMatchObject({ event: "restore.failed" });
    const replaced = run("restore.sh", [dump], { RESTORE_TARGET_URL: target, RESTORE_REPLACE: "yes" });
    expect(replaced.status, replaced.stderr).toBe(0);
  });

  it("never reads DATABASE_URL: without an explicit target it refuses (it cannot hit the live database by accident)", () => {
    const r = run("restore.sh", [path.join(dir, dumpOf())], { DATABASE_URL: URL_ });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("RESTORE_TARGET_URL is required");
  });

  it("refuses a target database name that is not a plain identifier, in both modes, before touching any database or container", async () => {
    const dump = path.join(dir, dumpOf());
    for (const name of [`bad'name`, `bad"name`, "x;y", "with space", "1starts_with_digit", "a".repeat(64)]) {
      // lib-pg.sh takes the database name from the URL path verbatim (no decoding), so the raw name is what restore.sh sees.
      const direct = run("restore.sh", [dump], { RESTORE_TARGET_URL: scratchUrl(name) });
      expect(direct.status, `direct ${name}`).toBe(1);
      expect(lines(direct.stdout).at(-1), `direct ${name}`).toMatchObject({ event: "restore.failed", reason: "invalid_database_name" });
      // Compose mode fails on the name before running docker (none is needed for this test).
      const compose = run("restore.sh", [dump], { BACKUP_MODE: "compose", RESTORE_DB: name });
      expect(compose.status, `compose ${name}`).toBe(1);
      expect(lines(compose.stdout).at(-1), `compose ${name}`).toMatchObject({ event: "restore.failed", reason: "invalid_database_name" });
    }
    const created = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM pg_database WHERE datname LIKE 'bad%' OR datname LIKE 'x;%' OR datname LIKE 'with %'`);
    expect(Number(created[0]!.n)).toBe(0);
  });

  it("detects a corrupted dump through the checksum before touching any database", () => {
    const good = path.join(dir, dumpOf());
    const bad = path.join(dir, "storebuilder-tampered.dump");
    copyFileSync(good, bad);
    writeFileSync(`${bad}.sha256`, readFileSync(`${good}.sha256`, "utf8").replace(/storebuilder-\S+\.dump/, "storebuilder-tampered.dump"));
    writeFileSync(bad, Buffer.concat([readFileSync(bad), Buffer.from("x")]));
    const r = run("restore.sh", [bad], { RESTORE_TARGET_URL: scratchUrl("restore_drill_b") });
    expect(r.status).toBe(1);
    expect(lines(r.stdout).at(-1)).toMatchObject({ event: "restore.failed", reason: "checksum_mismatch" });
  });

  it("a failing pg_dump (wrong password) fails the run, leaves no partial file and prints no secret", () => {
    const before = readdirSync(dir).length;
    const u = new URL(URL_);
    u.password = "definitely-wrong-password";
    const r = run("backup.sh", [], { DATABASE_URL: u.toString(), BACKUP_DIR: dir });
    expect(r.status).toBe(1);
    expect(lines(r.stdout).at(-1)).toMatchObject({ event: "backup.failed", reason: "pg_dump_failed" });
    expect(readdirSync(dir).length).toBe(before);
    expect(r.stdout + r.stderr).not.toContain("definitely-wrong-password");
  });

  it("prunes backups older than RETENTION_DAYS and keeps the new one; the after-hook gets the file path", () => {
    const old = path.join(dir, "storebuilder-20200101T000000Z.dump");
    writeFileSync(old, "old");
    writeFileSync(`${old}.sha256`, "x");
    const longAgo = new Date(Date.now() - 40 * 86_400_000);
    utimesSync(old, longAgo, longAgo);
    utimesSync(`${old}.sha256`, longAgo, longAgo);
    const hook = path.join(dir, "hook.sh");
    writeFileSync(hook, `#!/usr/bin/env bash\necho "$1" > "${dir}/hook-called"\n`, { mode: 0o755 });
    const r = run("backup.sh", [], { DATABASE_URL: URL_, BACKUP_DIR: dir, RETENTION_DAYS: "14", BACKUP_AFTER_HOOK: hook });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(`${old}.sha256`)).toBe(false);
    expect(lines(r.stdout).find((e) => e.event === "backup.pruned")).toMatchObject({ files: 2 });
    expect(readFileSync(path.join(dir, "hook-called"), "utf8").trim()).toMatch(/storebuilder-\d{8}T\d{6}Z\.dump$/);
  });
});
