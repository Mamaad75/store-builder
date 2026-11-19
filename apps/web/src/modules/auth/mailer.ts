import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { SmtpConfigError, createSmtpMailer, parseSmtpConfig } from "./smtp";

/**
 * Outgoing email, behind an interface so that callers never depend on a provider. Transports:
 *   - "smtp"  (MAIL_TRANSPORT=smtp + SMTP_* / MAIL_FROM, see ./smtp.ts): real delivery over mandatory TLS, any provider;
 *             an incomplete configuration refuses start-up in EVERY environment (decision DM2-1),
 *   - "none"  (the default outside development): nothing is sent; the failure is logged by class only,
 *   - "log"   (the default in development ONLY): the message is printed to the server console,
 *   - "file"  (MAIL_TRANSPORT=file + MAIL_OUTBOX_DIR): one JSON file per message, development and the E2E suite ONLY,
 *   (log and file are refused in production: see assertMailTransportAllowed)
 *   - an in-memory outbox that unit/DB tests inject with `setMailerForTests`.
 * Callers must treat sending as best effort and must never let its outcome change what they answer to the user
 * (that would reveal whether an address is registered).
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export class MailerNotConfiguredError extends Error {
  constructor() {
    super("No mail transport is configured (set MAIL_TRANSPORT)");
    this.name = "MailerNotConfiguredError";
  }
}

export const noneMailer: Mailer = {
  async send() {
    throw new MailerNotConfiguredError();
  },
};

export const logMailer: Mailer = {
  async send(m) {
    console.info(`[mail:log] to=${m.to} subject=${m.subject}\n${m.text}`);
  },
};

export function fileMailer(dir: string): Mailer {
  return {
    async send(m) {
      await mkdir(dir, { recursive: true });
      const name = `${Date.now()}-${randomBytes(4).toString("hex")}.json`;
      await writeFile(path.join(dir, name), JSON.stringify(m), { mode: 0o600 });
    },
  };
}

export class MemoryMailer implements Mailer {
  readonly outbox: MailMessage[] = [];
  async send(m: MailMessage) {
    this.outbox.push(m);
  }
}

/** The single test-only switch that lets the file outbox run in a production BUILD (the E2E suite runs `next start`). */
export const E2E_FILE_OUTBOX_OVERRIDE = "MAIL_E2E_FILE_OUTBOX_OVERRIDE";

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigError";
  }
}

const normalizeTransport = (env: Record<string, string | undefined>) => (env.MAIL_TRANSPORT ?? "").trim().toLowerCase();

/** Same strictness as the host policy: ONLY the exact values "development" and "test" are non-production. */
const isNonProduction = (env: Record<string, string | undefined>) => env.NODE_ENV === "development" || env.NODE_ENV === "test";

const isLoopbackRoot = (env: Record<string, string | undefined>) => {
  const host = (env.APP_ROOT_DOMAIN ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  return env.APP_PROTOCOL === "http" && (host === "localhost" || host === "127.0.0.1");
};

/**
 * Production guard (decision D12-8). The `log` transport prints whole messages (including the live password-reset link) and the
 * `file` transport writes them to disk, so neither may ever run in production, staging or any environment whose NODE_ENV is not
 * exactly "development" or "test". Called at server start (`src/instrumentation.ts`, which makes the process refuse to boot) and
 * again by `createMailer` (defence in depth).
 *
 * The only exception is the E2E suite, which runs a production build: `MAIL_TRANSPORT=file` is accepted there only with
 * `MAIL_E2E_FILE_OUTBOX_OVERRIDE=1` AND a loopback `APP_ROOT_DOMAIN` (localhost / 127.0.0.1) over plain http, which no real
 * deployment can have. `log` has no override at all. The override prints a warning at start-up (never the outbox contents).
 */
export function assertMailTransportAllowed(env: Record<string, string | undefined> = process.env): void {
  if (isNonProduction(env)) return;
  const kind = normalizeTransport(env);
  if (kind === "log") throw new MailConfigError("MAIL_TRANSPORT=log is not allowed outside development and test");
  if (kind === "file") {
    if (env[E2E_FILE_OUTBOX_OVERRIDE] !== "1" || !isLoopbackRoot(env)) {
      throw new MailConfigError("MAIL_TRANSPORT=file is not allowed outside development and test");
    }
    console.warn("[mail] WARNING: file outbox enabled by the E2E override on a loopback host; never use this in a deployment");
  }
}

/**
 * Start-up entry point: a forbidden configuration must stop the process. Throwing from the Next.js instrumentation hook alone
 * only makes every request answer 500 while the process keeps running (verified), so the process exits with a non-zero code.
 * The message names the setting, never a value that could carry a secret.
 */
export function enforceMailTransportAtStartup(env: Record<string, string | undefined> = process.env, exit: (code: number) => never = process.exit): void {
  try {
    assertMailTransportAllowed(env);
    assertSmtpConfigured(env);
  } catch (e) {
    console.error(`[mail] startup refused: ${e instanceof MailConfigError ? e.message : "invalid mail configuration"}`);
    exit(1);
  }
}

/**
 * `MAIL_TRANSPORT=smtp` with an incomplete or invalid configuration is refused in every environment (a half-configured mailer
 * would silently drop every reset mail). The message names variables only.
 */
export function assertSmtpConfigured(env: Record<string, string | undefined> = process.env): void {
  if (normalizeTransport(env) !== "smtp") return;
  try {
    parseSmtpConfig(env);
  } catch (e) {
    if (e instanceof SmtpConfigError) throw new MailConfigError(e.message);
    throw e;
  }
}

export function createMailer(env: Record<string, string | undefined> = process.env): Mailer {
  assertMailTransportAllowed(env);
  const kind = normalizeTransport(env) || (env.NODE_ENV === "development" ? "log" : "none");
  switch (kind) {
    case "smtp":
      assertSmtpConfigured(env);
      return createSmtpMailer(parseSmtpConfig(env));
    case "log":
      return logMailer;
    case "file": {
      const dir = env.MAIL_OUTBOX_DIR;
      return dir ? fileMailer(dir) : noneMailer;
    }
    default:
      return noneMailer;
  }
}

let current: Mailer | undefined;
export function getMailer(): Mailer {
  current ??= createMailer();
  return current;
}
/** Test seam. */
export function setMailerForTests(mailer: Mailer | undefined): void {
  current = mailer;
}
