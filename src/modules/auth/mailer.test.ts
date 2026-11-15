import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { E2E_FILE_OUTBOX_OVERRIDE, MailConfigError, MailerNotConfiguredError, MemoryMailer, assertMailTransportAllowed, createMailer, enforceMailTransportAtStartup } from "./mailer";
import { changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from "./schemas";

const msg = { to: "a@example.com", subject: "s", text: "t" };

describe("mail transports (no provider is connected: decision D12-2)", () => {
  it("outside development the default is 'none' and sending fails closed", async () => {
    await expect(createMailer({ NODE_ENV: "production" }).send(msg)).rejects.toBeInstanceOf(MailerNotConfiguredError);
    await expect(createMailer({}).send(msg)).rejects.toBeInstanceOf(MailerNotConfiguredError);
    await expect(createMailer({ NODE_ENV: "test" }).send(msg)).rejects.toBeInstanceOf(MailerNotConfiguredError);
  });
  it("'file' without a directory is not a transport; an unknown value is 'none'", async () => {
    await expect(createMailer({ NODE_ENV: "test", MAIL_TRANSPORT: "file" }).send(msg)).rejects.toBeInstanceOf(MailerNotConfiguredError);
    await expect(createMailer({ NODE_ENV: "production", MAIL_TRANSPORT: "smtp" }).send(msg)).rejects.toBeInstanceOf(MailerNotConfiguredError);
  });
  it("development defaults to the console transport", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    await createMailer({ NODE_ENV: "development" }).send(msg);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
  it("'file' writes one JSON message per send", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "outbox-"));
    try {
      const m = createMailer({ NODE_ENV: "test", MAIL_TRANSPORT: "file", MAIL_OUTBOX_DIR: dir });
      await m.send(msg);
      await m.send({ ...msg, subject: "two" });
      const files = await readdir(dir);
      expect(files).toHaveLength(2);
      expect(JSON.parse(await readFile(path.join(dir, files[0]!), "utf8"))).toMatchObject({ to: msg.to });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("the memory outbox records messages", async () => {
    const m = new MemoryMailer();
    await m.send(msg);
    expect(m.outbox).toEqual([msg]);
  });
});

const TOKEN_URL = "http://localhost:3000/reset-password?token=" + "T".repeat(43);

describe("production mail guard (decision D12-8)", () => {
  const prodLike = [{ NODE_ENV: "production" }, { NODE_ENV: "staging" }, { NODE_ENV: "Production" }, { NODE_ENV: "prod" }, { NODE_ENV: "" }, {}];

  it("log and file are refused in production and in EVERY non-development/test environment, whatever the casing or spacing", () => {
    for (const base of prodLike) {
      for (const transport of ["log", "file", "LOG", "File", " log ", "\tfile\n"]) {
        const env = { ...base, MAIL_TRANSPORT: transport, MAIL_OUTBOX_DIR: "/tmp/x" };
        expect(() => assertMailTransportAllowed(env), JSON.stringify(env)).toThrow(MailConfigError);
        expect(() => createMailer(env), JSON.stringify(env)).toThrow(MailConfigError);
      }
    }
  });
  it("the same transports stay available in development and test", () => {
    for (const NODE_ENV of ["development", "test"]) {
      for (const transport of ["log", "file"]) expect(() => assertMailTransportAllowed({ NODE_ENV, MAIL_TRANSPORT: transport, MAIL_OUTBOX_DIR: "/tmp/x" })).not.toThrow();
    }
  });
  it("'none' and unset are the only production-safe values", () => {
    for (const MAIL_TRANSPORT of [undefined, "", "none", "smtp"]) expect(() => assertMailTransportAllowed({ NODE_ENV: "production", MAIL_TRANSPORT })).not.toThrow();
  });
  it("the E2E override is for file only, needs the exact value 1, and a loopback http root domain", () => {
    const e2e = { NODE_ENV: "production", MAIL_TRANSPORT: "file", MAIL_OUTBOX_DIR: "/tmp/x", APP_ROOT_DOMAIN: "localhost:3100", APP_PROTOCOL: "http", [E2E_FILE_OUTBOX_OVERRIDE]: "1" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertMailTransportAllowed(e2e)).not.toThrow();
    expect(warn).toHaveBeenCalledOnce(); // never silent
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/token|reset-password|http/);
    warn.mockRestore();
    // log has NO override
    expect(() => assertMailTransportAllowed({ ...e2e, MAIL_TRANSPORT: "log" })).toThrow(MailConfigError);
    // wrong / missing override values
    for (const v of [undefined, "", "0", "true", "yes", "2"]) expect(() => assertMailTransportAllowed({ ...e2e, [E2E_FILE_OUTBOX_OVERRIDE]: v })).toThrow(MailConfigError);
    // a real domain, https, or lookalike hosts cannot use it
    for (const d of [{ APP_ROOT_DOMAIN: "example.com" }, { APP_ROOT_DOMAIN: "shop.example.com:443" }, { APP_ROOT_DOMAIN: "localhost.evil.com" }, { APP_ROOT_DOMAIN: "evil.com/localhost" }, { APP_ROOT_DOMAIN: undefined }, { APP_PROTOCOL: "https" }, { APP_PROTOCOL: undefined }]) {
      expect(() => assertMailTransportAllowed({ ...e2e, ...d }), JSON.stringify(d)).toThrow(MailConfigError);
    }
    // the override alone does nothing in production without file transport, and does not widen anything else
    expect(() => assertMailTransportAllowed({ NODE_ENV: "production", MAIL_TRANSPORT: "log", [E2E_FILE_OUTBOX_OVERRIDE]: "1", APP_ROOT_DOMAIN: "localhost:3100", APP_PROTOCOL: "http" })).toThrow(MailConfigError);
  });
  it("start-up enforcement exits the process with code 1 for a forbidden transport and is silent for an allowed one", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.fn((code: number): never => {
      throw new Error(`exit:${code}`);
    });
    expect(() => enforceMailTransportAtStartup({ NODE_ENV: "production", MAIL_TRANSPORT: "log" }, exit)).toThrow("exit:1");
    expect(() => enforceMailTransportAtStartup({ NODE_ENV: "production", MAIL_TRANSPORT: "file", MAIL_OUTBOX_DIR: "/x" }, exit)).toThrow("exit:1");
    expect(err.mock.calls.flat().join(" ")).toMatch(/startup refused: MAIL_TRANSPORT=log is not allowed/);
    exit.mockClear();
    enforceMailTransportAtStartup({ NODE_ENV: "production", MAIL_TRANSPORT: "none" }, exit);
    enforceMailTransportAtStartup({ NODE_ENV: "development", MAIL_TRANSPORT: "log" }, exit);
    expect(exit).not.toHaveBeenCalled();
    err.mockRestore();
  });
  it("a REAL process started with the production settings and a forbidden transport exits 1 before doing anything", () => {
    const run = (env: Record<string, string>) =>
      spawnSync("pnpm", ["exec", "tsx", "-e", 'import { enforceMailTransportAtStartup } from "./src/modules/auth/mailer"; enforceMailTransportAtStartup(); console.log("STARTED");'], {
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } as unknown as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: 60_000,
      });
    for (const MAIL_TRANSPORT of ["log", "file"]) {
      const r = run({ NODE_ENV: "production", MAIL_TRANSPORT, MAIL_OUTBOX_DIR: "/tmp/ob" });
      expect(r.status, MAIL_TRANSPORT).toBe(1);
      expect(r.stdout).not.toContain("STARTED");
      expect(r.stderr).toMatch(/startup refused/);
    }
    const ok = run({ NODE_ENV: "production", MAIL_TRANSPORT: "none" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("STARTED");
  });
  it("the production mailer never logs a reset token or link, and the refusal message contains none either", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await expect(createMailer({ NODE_ENV: "production" }).send({ ...msg, text: TOKEN_URL })).rejects.toBeInstanceOf(MailerNotConfiguredError);
    await expect(createMailer({ NODE_ENV: "production", MAIL_TRANSPORT: "none" }).send({ ...msg, text: TOKEN_URL })).rejects.toBeInstanceOf(MailerNotConfiguredError);
    let refusal = "";
    try {
      createMailer({ NODE_ENV: "production", MAIL_TRANSPORT: "log" });
    } catch (e) {
      refusal = String(e instanceof Error ? e.message : e);
    }
    expect(refusal).toMatch(/not allowed/);
    const logged = spies.flatMap((s) => s.mock.calls.flat()).join(" ");
    for (const text of [logged, refusal]) {
      expect(text).not.toContain("T".repeat(43));
      expect(text).not.toContain("reset-password");
    }
    for (const s of spies) s.mockRestore();
  });
});

describe("account input schemas", () => {
  it("forgot: a normalised email only", () => {
    expect(forgotPasswordSchema.parse({ email: "  ALI@Example.com " }).email).toBe("ali@example.com");
    expect(forgotPasswordSchema.safeParse({ email: "x" }).success).toBe(false);
  });
  it("reset: exactly a 43-character base64url token and a bounded password", () => {
    const token = "A".repeat(43);
    expect(resetPasswordSchema.safeParse({ token, password: "12345678" }).success).toBe(true);
    for (const bad of ["", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}!`, "../../etc/passwd"]) expect(resetPasswordSchema.safeParse({ token: bad, password: "12345678" }).success, bad).toBe(false);
    expect(resetPasswordSchema.safeParse({ token, password: "1234567" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token, password: "x".repeat(129) }).success).toBe(false);
  });
  it("change: new password differs from the current one", () => {
    expect(changePasswordSchema.safeParse({ currentPassword: "abcdefgh", newPassword: "abcdefgh" }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: "abcdefgh", newPassword: "abcdefgi" }).success).toBe(true);
  });
});
