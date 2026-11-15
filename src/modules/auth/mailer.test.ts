import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MailerNotConfiguredError, MemoryMailer, createMailer } from "./mailer";
import { changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from "./schemas";

const msg = { to: "a@example.com", subject: "s", text: "t" };

describe("mail transports (no provider is connected: decision D12-2)", () => {
  it("outside development the default is 'none' and sending fails closed", async () => {
    await expect(createMailer({ NODE_ENV: "production" }).send(msg)).rejects.toBeInstanceOf(MailerNotConfiguredError);
    await expect(createMailer({}).send(msg)).rejects.toBeInstanceOf(MailerNotConfiguredError);
    await expect(createMailer({ NODE_ENV: "test" }).send(msg)).rejects.toBeInstanceOf(MailerNotConfiguredError);
  });
  it("'file' without a directory is not a transport; an unknown value is 'none'", async () => {
    await expect(createMailer({ MAIL_TRANSPORT: "file" }).send(msg)).rejects.toBeInstanceOf(MailerNotConfiguredError);
    await expect(createMailer({ MAIL_TRANSPORT: "smtp" }).send(msg)).rejects.toBeInstanceOf(MailerNotConfiguredError);
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
      const m = createMailer({ MAIL_TRANSPORT: "file", MAIL_OUTBOX_DIR: dir });
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
