import { describe, expect, it, vi } from "vitest";
import { MailConfigError, assertSmtpConfigured, createMailer, enforceMailTransportAtStartup } from "./mailer";
import { SmtpConfigError, createSmtpMailer, parseSmtpConfig, smtpTransportOptions, type SmtpTransportOptions } from "./smtp";

/** No network: configuration, the exact options given to nodemailer, and the message shape (MVP step M2, decision DM2-1). */
const SECRET = "s3cret-Password-value!";
const base = { SMTP_HOST: "smtp.example.ir", SMTP_USER: "noreply@example.ir", SMTP_PASSWORD: SECRET, MAIL_FROM: "فروشگاه‌ساز <noreply@example.ir>" };

describe("SMTP configuration", () => {
  it("defaults to port 587 with STARTTLS; port 465 means implicit TLS; SMTP_SECURE overrides", () => {
    expect(parseSmtpConfig(base)).toMatchObject({ host: "smtp.example.ir", port: 587, secure: false, user: "noreply@example.ir", password: SECRET });
    expect(parseSmtpConfig({ ...base, SMTP_PORT: "465" }).secure).toBe(true);
    expect(parseSmtpConfig({ ...base, SMTP_PORT: "2525", SMTP_SECURE: "TRUE" }).secure).toBe(true);
    expect(parseSmtpConfig({ ...base, SMTP_PORT: "465", SMTP_SECURE: "false" }).secure).toBe(false);
  });

  it("credentials come as a pair or not at all (an unauthenticated relay)", () => {
    const { SMTP_USER: _u, SMTP_PASSWORD: _p, ...noAuth } = base;
    void _u;
    void _p;
    expect(parseSmtpConfig(noAuth)).toMatchObject({ user: undefined, password: undefined });
    expect(() => parseSmtpConfig({ ...noAuth, SMTP_USER: "x" })).toThrow(/SMTP_PASSWORD/);
    expect(() => parseSmtpConfig({ ...noAuth, SMTP_PASSWORD: "x" })).toThrow(/SMTP_USER/);
  });

  it("rejects bad values and names only the variables, never a value (values can be secrets)", () => {
    const bad = { SMTP_HOST: "smtp.example.ir/x", SMTP_PORT: "70000", SMTP_SECURE: "maybe", SMTP_USER: "u", SMTP_PASSWORD: SECRET, MAIL_FROM: "no-address" };
    let err: unknown;
    try {
      parseSmtpConfig(bad);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SmtpConfigError);
    const message = (err as Error).message;
    for (const name of ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "MAIL_FROM"]) expect(message).toContain(name);
    for (const value of [SECRET, "smtp.example.ir/x", "70000", "no-address"]) expect(message).not.toContain(value);
  });

  it("MAIL_FROM cannot inject headers and must contain an address", () => {
    for (const from of ["a@b.ir\r\nBcc: x@y.ir", "Name <a@b.ir>\nX: y", "just a name", ""]) {
      expect(() => parseSmtpConfig({ ...base, MAIL_FROM: from }), JSON.stringify(from)).toThrow(/MAIL_FROM/);
    }
    expect(parseSmtpConfig({ ...base, MAIL_FROM: "noreply@example.ir" }).from).toBe("noreply@example.ir");
  });

  it("an extra CA is read from SMTP_TLS_CA_FILE; an unreadable file is a configuration error", () => {
    expect(parseSmtpConfig({ ...base, SMTP_TLS_CA_FILE: "/ca.pem" }, () => "PEM").ca).toBe("PEM");
    expect(() =>
      parseSmtpConfig({ ...base, SMTP_TLS_CA_FILE: "/missing.pem" }, () => {
        throw new Error("ENOENT");
      }),
    ).toThrow(/SMTP_TLS_CA_FILE/);
  });
});

describe("transport options handed to nodemailer", () => {
  it("STARTTLS is mandatory without implicit TLS; certificates are always verified; timeouts bounded; logging off", () => {
    const o = smtpTransportOptions(parseSmtpConfig(base));
    expect(o).toMatchObject({ port: 587, secure: false, requireTLS: true, ignoreTLS: false, logger: false, debug: false });
    expect(o.tls).toEqual({ minVersion: "TLSv1.2", rejectUnauthorized: true });
    expect(o.auth).toEqual({ user: "noreply@example.ir", pass: SECRET });
    for (const t of [o.connectionTimeout, o.greetingTimeout, o.socketTimeout]) expect(t).toBeGreaterThan(0);
    for (const t of [o.connectionTimeout, o.greetingTimeout, o.socketTimeout]) expect(t).toBeLessThanOrEqual(30_000);
  });

  it("implicit TLS needs no STARTTLS; an extra CA never turns verification off; no credentials means no auth block", () => {
    const { SMTP_USER: _u, SMTP_PASSWORD: _p, ...noAuth } = base;
    void _u;
    void _p;
    const o = smtpTransportOptions(parseSmtpConfig({ ...noAuth, SMTP_PORT: "465", SMTP_TLS_CA_FILE: "/ca.pem" }, () => "PEM"));
    expect(o).toMatchObject({ secure: true, requireTLS: false });
    expect(o.tls).toMatchObject({ rejectUnauthorized: true, ca: "PEM" });
    expect("auth" in o).toBe(false);
  });

  it("the mailer sends from MAIL_FROM and forbids file and URL access in the message", async () => {
    const sent: unknown[] = [];
    let options: SmtpTransportOptions | undefined;
    const mailer = createSmtpMailer(parseSmtpConfig(base), (o) => {
      options = o;
      return { sendMail: async (m) => void sent.push(m) };
    });
    await mailer.send({ to: "user@example.com", subject: "s", text: "t" });
    expect(options?.host).toBe("smtp.example.ir");
    expect(sent).toEqual([{ from: base.MAIL_FROM, to: "user@example.com", subject: "s", text: "t", disableFileAccess: true, disableUrlAccess: true }]);
  });

  it("a transport failure propagates to the caller (which logs the class only and never changes its answer)", async () => {
    const mailer = createSmtpMailer(parseSmtpConfig(base), () => ({ sendMail: async () => Promise.reject(new Error("ECONNREFUSED")) }));
    await expect(mailer.send({ to: "u@example.com", subject: "s", text: "t" })).rejects.toThrow("ECONNREFUSED");
  });
});

describe("MAIL_TRANSPORT=smtp wiring", () => {
  it("an incomplete smtp configuration is refused in EVERY environment, development included (names only)", () => {
    for (const NODE_ENV of ["production", "development", "test"]) {
      const env = { NODE_ENV, MAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.example.ir", SMTP_PASSWORD: SECRET };
      expect(() => assertSmtpConfigured(env), NODE_ENV).toThrow(MailConfigError);
      expect(() => createMailer(env), NODE_ENV).toThrow(/MAIL_FROM/);
      const exit = vi.fn() as unknown as (code: number) => never;
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      enforceMailTransportAtStartup(env, exit);
      expect(exit).toHaveBeenCalledWith(1);
      expect(spy.mock.calls.flat().join(" ")).not.toContain(SECRET);
      spy.mockRestore();
    }
  });

  it("a complete smtp configuration is accepted in production and builds a mailer (no connection is opened until a send)", () => {
    const env = { NODE_ENV: "production", MAIL_TRANSPORT: " SMTP ", ...base };
    expect(() => assertSmtpConfigured(env)).not.toThrow();
    expect(typeof createMailer(env).send).toBe("function");
    const exit = vi.fn() as unknown as (code: number) => never;
    enforceMailTransportAtStartup(env, exit);
    expect(exit).not.toHaveBeenCalled();
  });
});
