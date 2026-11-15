import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Outgoing email, behind an interface so that a real provider can be added in phase 14 without touching callers.
 * NO provider is connected today (decision D12-2): the only transports are
 *   - "none"  (the default outside development): nothing is sent; the failure is logged by class only,
 *   - "log"   (the default in development): the message is printed to the server console,
 *   - "file"  (MAIL_TRANSPORT=file + MAIL_OUTBOX_DIR): one JSON file per message, used by the E2E suite,
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

export function createMailer(env: Record<string, string | undefined> = process.env): Mailer {
  const kind = env.MAIL_TRANSPORT || (env.NODE_ENV === "development" ? "log" : "none");
  switch (kind) {
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
