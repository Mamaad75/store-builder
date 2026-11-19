import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSmtpMailer, parseSmtpConfig } from "./smtp";

/**
 * REAL SMTP against throw-away Mailpit servers (scripts/ci-start-mailpit.sh; CI job "mail"). Proves end to end that:
 *  - a reset-style message is delivered over STARTTLS with authentication, Persian subject intact;
 *  - certificate verification is really on (an untrusted certificate fails the send);
 *  - the client refuses a server that offers no TLS at all (no plain-text fallback).
 * Safety: only loopback hosts are accepted; nothing is relayed anywhere.
 */
// 127.0.0.1, not "localhost": on some systems localhost resolves to ::1 first while the test servers listen on IPv4 only.
// The generated certificate carries IP:127.0.0.1 in its subjectAltName, so verification still applies.
const HOST = process.env.TEST_SMTP_HOST ?? "127.0.0.1";
const CA_FILE = process.env.TEST_SMTP_CA_FILE;
const API = process.env.TEST_MAILPIT_API ?? "http://127.0.0.1:8025";
if (!["localhost", "127.0.0.1", "::1"].includes(HOST)) throw new Error(`Refusing to run mail tests against a non-local host: ${HOST}`);
if (!CA_FILE) throw new Error("TEST_SMTP_CA_FILE is required (written by scripts/ci-start-mailpit.sh)");

const env = (over: Record<string, string | undefined> = {}) => ({
  SMTP_HOST: HOST,
  SMTP_PORT: "2525",
  SMTP_USER: "test-user",
  SMTP_PASSWORD: "test-only-password",
  MAIL_FROM: "فروشگاه‌ساز <noreply@store-builder.test>",
  SMTP_TLS_CA_FILE: CA_FILE,
  ...over,
});

interface MailpitList {
  messages: { From: { Address: string }; To: { Address: string }[]; Subject: string }[];
}
const messages = async () => ((await (await fetch(`${API}/api/v1/messages`)).json()) as MailpitList).messages;

beforeEach(async () => {
  await fetch(`${API}/api/v1/messages`, { method: "DELETE" });
});
afterAll(async () => {
  await fetch(`${API}/api/v1/messages`, { method: "DELETE" });
});

describe("SMTP transport against a real server", () => {
  it("delivers over STARTTLS with authentication; sender, recipient and the Persian subject arrive intact", async () => {
    const mailer = createSmtpMailer(parseSmtpConfig(env()));
    await mailer.send({ to: "customer@example.com", subject: "بازیابی رمز عبور", text: "پیوند: https://example.test/reset-password?token=x" });
    const got = await messages();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ From: { Address: "noreply@store-builder.test" }, To: [{ Address: "customer@example.com" }], Subject: "بازیابی رمز عبور" });
  });

  it("an untrusted server certificate fails the send (verification is never off), and nothing is delivered", async () => {
    const mailer = createSmtpMailer(parseSmtpConfig(env({ SMTP_TLS_CA_FILE: undefined })));
    // The failure must be the certificate check, not some unrelated connection problem.
    await expect(mailer.send({ to: "customer@example.com", subject: "s", text: "t" })).rejects.toThrow(/certificate/i);
    expect(await messages()).toHaveLength(0);
  });

  it("a server that offers no TLS gets nothing: STARTTLS is required, never skipped", async () => {
    const plainApi = process.env.TEST_MAILPIT_PLAIN_API ?? "http://127.0.0.1:8026";
    await fetch(`${plainApi}/api/v1/messages`, { method: "DELETE" });
    const mailer = createSmtpMailer(parseSmtpConfig(env({ SMTP_PORT: "2526" })));
    // The failure must be the missing STARTTLS, i.e. the server WAS reached and the client refused to continue in plain text.
    await expect(mailer.send({ to: "customer@example.com", subject: "s", text: "t" })).rejects.toThrow(/STARTTLS/i);
    const plain = ((await (await fetch(`${plainApi}/api/v1/messages`)).json()) as MailpitList).messages;
    expect(plain).toHaveLength(0);
  });
});
