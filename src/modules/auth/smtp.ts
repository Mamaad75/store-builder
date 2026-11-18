import { readFileSync } from "node:fs";
import { createTransport } from "nodemailer";
import { z } from "zod";
import type { Mailer } from "./mailer";

/**
 * Real outgoing mail over SMTP (phase 14 gate D12-2, implemented ahead as MVP step M2). Provider-neutral: any SMTP service is
 * connected through the environment only. The ONLY file that imports nodemailer (architecture test).
 *
 * Security properties (never configurable away):
 *  - transport encryption is mandatory: implicit TLS (`SMTP_SECURE=true`, usually port 465) or STARTTLS that MUST succeed
 *    (`requireTLS`), so a server or attacker that strips STARTTLS makes sending fail instead of falling back to plain text;
 *  - the server certificate is always verified (`rejectUnauthorized`); `SMTP_TLS_CA_FILE` can ADD a trust anchor (private CA, tests),
 *    it never disables verification; TLS 1.2 minimum;
 *  - bounded connection, greeting and socket timeouts;
 *  - nodemailer's own logging is off, and messages may not read local files or URLs;
 *  - configuration errors name variables, never values (they can be secrets).
 */
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  ca?: string;
}

export class SmtpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpConfigError";
  }
}

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
// "addr@domain" or "Display Name <addr@domain>"; no CR/LF (header injection), bounded length.
const FROM_RE = /^(?:[^<>\r\n]{1,100} )?<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/;

const schema = z
  .object({
    SMTP_HOST: z.string().regex(HOST_RE),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: z.enum(["true", "false"]).optional(),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    MAIL_FROM: z.string().max(320).regex(FROM_RE),
    SMTP_TLS_CA_FILE: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    // Credentials come as a pair or not at all (an unauthenticated relay); half a pair is always a mistake.
    if ((v.SMTP_USER === undefined) !== (v.SMTP_PASSWORD === undefined)) {
      ctx.addIssue({ code: "custom", path: [v.SMTP_USER === undefined ? "SMTP_USER" : "SMTP_PASSWORD"], message: "pair" });
    }
  });

const blankToUndefined = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());

/** Validated SMTP configuration from the environment. Throws SmtpConfigError naming the bad variables (never their values). */
export function parseSmtpConfig(env: Record<string, string | undefined>, readFile: (path: string) => string = (p) => readFileSync(p, "utf8")): SmtpConfig {
  const r = schema.safeParse({
    SMTP_HOST: blankToUndefined(env.SMTP_HOST),
    SMTP_PORT: blankToUndefined(env.SMTP_PORT),
    SMTP_SECURE: blankToUndefined(env.SMTP_SECURE)?.toLowerCase(),
    SMTP_USER: blankToUndefined(env.SMTP_USER),
    SMTP_PASSWORD: env.SMTP_PASSWORD === "" ? undefined : env.SMTP_PASSWORD, // a password is taken verbatim (no trimming)
    MAIL_FROM: blankToUndefined(env.MAIL_FROM),
    SMTP_TLS_CA_FILE: blankToUndefined(env.SMTP_TLS_CA_FILE),
  });
  if (!r.success) {
    const names = [...new Set(r.error.issues.map((i) => String(i.path[0])))];
    throw new SmtpConfigError(`SMTP configuration invalid or missing: ${names.join(", ")}`);
  }
  const d = r.data;
  let ca: string | undefined;
  if (d.SMTP_TLS_CA_FILE) {
    try {
      ca = readFile(d.SMTP_TLS_CA_FILE);
    } catch {
      throw new SmtpConfigError("SMTP configuration invalid or missing: SMTP_TLS_CA_FILE (unreadable)");
    }
  }
  return {
    host: d.SMTP_HOST,
    port: d.SMTP_PORT,
    secure: d.SMTP_SECURE === undefined ? d.SMTP_PORT === 465 : d.SMTP_SECURE === "true",
    user: d.SMTP_USER,
    password: d.SMTP_PASSWORD,
    from: d.MAIL_FROM,
    ca,
  };
}

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  ignoreTLS: false;
  auth?: { user: string; pass: string };
  // The certificate is checked against `host` (nodemailer also sends it as SNI when it is a name, not an IP).
  tls: { minVersion: "TLSv1.2"; rejectUnauthorized: true; ca?: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  logger: false;
  debug: false;
}

/** The exact options handed to nodemailer (pure, unit-tested). */
export function smtpTransportOptions(cfg: SmtpConfig): SmtpTransportOptions {
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    // Without implicit TLS, STARTTLS is mandatory: no plain-text fallback.
    requireTLS: !cfg.secure,
    ignoreTLS: false,
    ...(cfg.user !== undefined && cfg.password !== undefined ? { auth: { user: cfg.user, pass: cfg.password } } : {}),
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true, ...(cfg.ca ? { ca: cfg.ca } : {}) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    logger: false,
    debug: false,
  };
}

export interface SmtpTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    disableFileAccess: true;
    disableUrlAccess: true;
  }): Promise<unknown>;
}
export type SmtpTransportFactory = (options: SmtpTransportOptions) => SmtpTransport;

const nodemailerFactory: SmtpTransportFactory = (options) => createTransport(options) as unknown as SmtpTransport;

export function createSmtpMailer(cfg: SmtpConfig, factory: SmtpTransportFactory = nodemailerFactory): Mailer {
  const transport = factory(smtpTransportOptions(cfg));
  return {
    async send(m) {
      await transport.sendMail({ from: cfg.from, to: m.to, subject: m.subject, text: m.text, disableFileAccess: true, disableUrlAccess: true });
    },
  };
}
