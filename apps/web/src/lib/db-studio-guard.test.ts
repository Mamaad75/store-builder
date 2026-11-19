import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStudioCommand, checkStudioEnvironment, parseEnvFile, parseStudioArgs, STUDIO_HOSTNAME } from "../../scripts/db-studio-guard";

const ok = (url: string) => checkStudioEnvironment({ NODE_ENV: "development", DATABASE_URL: url });

describe("db:studio accepts only a database on this machine", () => {
  it.each([
    "postgresql://storebuilder:storebuilder@localhost:5432/storebuilder",
    "postgresql://storebuilder:storebuilder@127.0.0.1:5432/storebuilder_test",
    "postgres://u:p@[::1]:5432/db",
    "postgresql://u:p@localhost/db?schema=public&connection_limit=5",
  ])("accepts %s", (url) => {
    expect(ok(url).ok).toBe(true);
  });

  it.each([
    ["a remote host", "postgresql://u:p@db.example.com:5432/db"],
    ["a production-looking host", "postgresql://u:p@prod-db.internal.example.com:5432/storebuilder"],
    ["a cloud host", "postgresql://u:p@abc.supabase.co:5432/postgres"],
    ["a private network IP", "postgresql://u:p@10.0.0.5:5432/db"],
    ["another loopback address", "postgresql://u:p@127.0.0.2:5432/db"],
    ["0.0.0.0", "postgresql://u:p@0.0.0.0:5432/db"],
    ["a trailing-dot name", "postgresql://u:p@localhost.:5432/db"],
    ["a name that merely starts with localhost", "postgresql://u:p@localhost.evil.com:5432/db"],
    ["a name that merely starts with 127.0.0.1", "postgresql://u:p@127.0.0.1.evil.com:5432/db"],
    ["userinfo that spells localhost", "postgresql://localhost:5432@evil.com/db"],
    ["userinfo localhost@remote", "postgresql://localhost@evil.com/db"],
    ["a multi-host URL", "postgresql://u:p@localhost,evil.com:5432/db"],
    ["a host override parameter", "postgresql://u:p@localhost/db?host=evil.com"],
    ["a socket-path override parameter", "postgresql://u:p@localhost/db?host=/var/run/postgresql"],
    ["a hostaddr override", "postgresql://u:p@localhost/db?hostaddr=203.0.113.9"],
    ["a service override", "postgresql://u:p@localhost/db?service=prod"],
    ["a non-PostgreSQL protocol", "mysql://u:p@localhost:3306/db"],
    ["a file URL", "file:./dev.db"],
    ["not a URL", "localhost"],
    ["an empty string", ""],
  ])("refuses %s", (_name, url) => {
    const r = ok(url);
    expect(r.ok).toBe(false);
  });

  it("refuses when DATABASE_URL is missing", () => {
    expect(checkStudioEnvironment({ NODE_ENV: "development" }).ok).toBe(false);
  });

  it("refuses NODE_ENV=production even for a local URL", () => {
    const r = checkStudioEnvironment({ NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@localhost/db" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/production/);
  });

  it("never reveals the password in the displayed form", () => {
    const r = ok("postgresql://storebuilder:s3cr3t-Pa55@localhost:5432/storebuilder");
    expect(r.ok && r.masked).toBe("postgresql://storebuilder:***@localhost:5432/storebuilder");
    expect(JSON.stringify(r.ok && r.masked)).not.toContain("s3cr3t");
  });
});

describe("db:studio arguments: the listening host cannot be changed", () => {
  it("defaults to port 5555 and no browser", () => {
    expect(parseStudioArgs([])).toEqual({ ok: true, port: "5555", browser: "none" });
    expect(parseStudioArgs(["--"])).toEqual({ ok: true, port: "5555", browser: "none" });
  });
  it("accepts --port/-p and --browser/-b", () => {
    expect(parseStudioArgs(["--port", "5556"])).toMatchObject({ ok: true, port: "5556" });
    expect(parseStudioArgs(["-p", "6000", "-b", "firefox"])).toMatchObject({ ok: true, port: "6000", browser: "firefox" });
  });
  it.each([["--hostname", "0.0.0.0"], ["--host", "0.0.0.0"], ["-n", "0.0.0.0"], ["--hostname=0.0.0.0"], ["0.0.0.0"], ["--config", "x.js"], ["--schema", "other.prisma"], ["--url", "postgresql://x"]])(
    "refuses %j",
    (...args) => {
      expect(parseStudioArgs(args).ok).toBe(false);
    },
  );
  it.each([["--port"], ["--port", "abc"], ["--port", "70000"], ["--port", "1"], ["--port", "55 55"], ["--browser", "firefox; rm -rf /"], ["--browser"]])("refuses invalid value %j", (...args) => {
    expect(parseStudioArgs(args).ok).toBe(false);
  });
});

describe("buildStudioCommand: what actually gets executed", () => {
  const good = { NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5432/storebuilder" };
  it("always binds to 127.0.0.1 and passes the validated URL explicitly (a .env file cannot override it)", () => {
    const r = buildStudioCommand(good, ["--port", "5560"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.command.command).toBe("pnpm");
    expect(r.command.args).toEqual(["exec", "prisma", "studio", "--hostname", STUDIO_HOSTNAME, "--port", "5560", "--browser", "none"]);
    expect(r.command.env.DATABASE_URL).toBe(good.DATABASE_URL);
    expect(STUDIO_HOSTNAME).toBe("127.0.0.1");
  });
  it("produces no command at all for a remote URL, production, or a host argument", () => {
    expect(buildStudioCommand({ ...good, DATABASE_URL: "postgresql://u:p@db.example.com/db" }, []).ok).toBe(false);
    expect(buildStudioCommand({ ...good, NODE_ENV: "production" }, []).ok).toBe(false);
    expect(buildStudioCommand(good, ["--hostname", "0.0.0.0"]).ok).toBe(false);
  });
});

describe("the real wrapper process (scripts/db-studio.ts) refuses before starting anything", () => {
  const run = (env: Record<string, string>, args: string[] = []) =>
    spawnSync("pnpm", ["exec", "tsx", "scripts/db-studio.ts", ...args], { env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 60_000 });

  it("exits 1 with a clear message for a remote DATABASE_URL, and never prints the 'Prisma Studio ->' banner", () => {
    const r = run({ DATABASE_URL: "postgresql://admin:topsecret@db.example.com:5432/prod" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/refused to start.*db\.example\.com/);
    expect(r.stdout).not.toContain("Prisma Studio ->");
    expect(r.stdout + r.stderr).not.toContain("topsecret");
  }, 70_000);

  it("exits 1 for NODE_ENV=production and for --hostname", () => {
    expect(run({ NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@localhost/db" }).status).toBe(1);
    const r = run({ DATABASE_URL: "postgresql://u:p@localhost/db" }, ["--hostname", "0.0.0.0"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unsupported argument/);
  }, 70_000);
});

describe("package.json: Studio can only be started through the guarded wrapper", () => {
  const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
  it("db:studio runs the wrapper, and no other script starts prisma studio directly", () => {
    expect(scripts["db:studio"]).toBe("tsx scripts/db-studio.ts");
    for (const [name, cmd] of Object.entries(scripts)) {
      if (name !== "db:studio") expect(cmd, name).not.toMatch(/prisma studio|db-studio/);
    }
  });
});

describe("parseEnvFile", () => {
  it("reads KEY=VALUE lines, quotes and ignores comments", () => {
    expect(parseEnvFile('# c\nDATABASE_URL="postgresql://u:p@localhost/db"\nexport X=1\n  # DATABASE_URL=bad\nY=\'q\'')).toEqual({ DATABASE_URL: "postgresql://u:p@localhost/db", X: "1", Y: "q" });
  });
});
