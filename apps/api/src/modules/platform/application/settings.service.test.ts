import { describe, expect, it } from "vitest";
import { SecretsUnavailableError } from "@store-builder/shared/modules/secrets/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { PLATFORM_SETTING_DEFAULTS } from "@store-builder/shared/modules/platform/settings";
import { PlatformSettingsService, type PlatformCipher, type Sealed, type SettingsRepository } from "./settings.service.js";

/** A reversible fake cipher that checks the context like the real one (and is visibly NOT the plaintext). */
const cipher: PlatformCipher = {
  seal: (context, value) => ({ keyId: "k1", wrappedKey: new Uint8Array(4), sealed: new TextEncoder().encode(`${context}#${[...value].reverse().join("")}`) }),
  open: (context, e) => {
    const [ctx, body] = new TextDecoder().decode(e.sealed).split("#");
    if (ctx !== context) throw new Error("context mismatch");
    return [...body!].reverse().join("");
  },
};

function memory() {
  const settings = new Map<string, unknown>();
  const secrets = new Map<string, { e: Sealed; hint: string | null }>();
  const audit: string[] = [];
  const repo: SettingsRepository = {
    all: async () => Object.fromEntries(settings),
    put: async (g, v, a) => void (settings.set(g, v), audit.push(`${a.action}:${a.targetId}`)),
    secrets: async () => [...secrets].map(([name, s]) => ({ name, hint: s.hint, updatedAt: new Date(0) })),
    secret: async (n) => secrets.get(n)?.e ?? null,
    putSecret: async (n, e, hint, a) => void (secrets.set(n, { e, hint }), audit.push(`${a.action}:${a.targetId}`)),
    removeSecret: async (n, a) => (secrets.delete(n) ? (audit.push(`${a.action}:${a.targetId}`), true) : false),
    audit: async (a) => void audit.push(`${a.action}:${a.targetId}`),
  };
  return { repo, settings, secrets, audit };
}

describe("platform settings (phase 3.1)", () => {
  it("a fresh platform reads as everything off; a valid update is stored and audited", async () => {
    const m = memory();
    const svc = new PlatformSettingsService(m.repo, cipher, true);
    expect(await svc.settings()).toEqual(PLATFORM_SETTING_DEFAULTS);
    const next = await svc.update("admin1", "sms", { provider: "kavenegar", customerOtpEnabled: true, otpTemplate: "verify-code" });
    expect(next.sms.customerOtpEnabled).toBe(true);
    expect(m.audit).toEqual(["platform.settings_updated:sms"]);
  });

  it("refuses unknown groups, extra fields and invalid values; an unreadable stored value falls back to the defaults", async () => {
    const m = memory();
    const svc = new PlatformSettingsService(m.repo, cipher, true);
    await expect(svc.update("a", "billing", {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.update("a", "payment", { zarinpalEnabled: true, sandbox: false, extra: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.update("a", "ai", { enabled: true, provider: "openai_compatible", baseUrl: "http://10.0.0.1/v1", model: "m" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.update("a", "ai", { enabled: true, provider: "openai_compatible", baseUrl: "https://u:p@ai.example.ir", model: "m" })).rejects.toBeInstanceOf(ValidationError);
    m.settings.set("payment", { zarinpalEnabled: "yes" });
    expect((await svc.settings()).payment).toEqual(PLATFORM_SETTING_DEFAULTS.payment);
  });

  it("secrets are write-only: the view shows configured/hint, never the value; reveal is server-side and bound to the name", async () => {
    const m = memory();
    const svc = new PlatformSettingsService(m.repo, cipher, true);
    const key = "kave-key-0000-1111-2222-WXYZ";
    await svc.setSecret("admin1", "sms.kavenegar.api_key", { value: ` ${key}\n` });
    const view = await svc.view();
    expect(JSON.stringify(view)).not.toContain("kave-key");
    expect(view.secrets["sms.kavenegar.api_key"]).toMatchObject({ configured: true, hint: "WXYZ" });
    expect(view.secrets["ai.api_key"].configured).toBe(false);
    expect(await svc.reveal("sms.kavenegar.api_key")).toBe(key);
    // an envelope moved to another name does not open
    m.secrets.set("ai.api_key", m.secrets.get("sms.kavenegar.api_key")!);
    await expect(svc.reveal("ai.api_key")).rejects.toThrow();
    await expect(svc.setSecret("a", "anything.else", { value: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.setSecret("a", "ai.api_key", { value: "a‮b" })).rejects.toBeInstanceOf(ValidationError);
    await svc.removeSecret("a", "sms.kavenegar.api_key");
    await expect(svc.removeSecret("a", "sms.kavenegar.api_key")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("without master keys secrets cannot be stored (and nothing is stored unprotected)", async () => {
    const m = memory();
    const svc = new PlatformSettingsService(m.repo, null, true);
    expect((await svc.view()).encryptionReady).toBe(false);
    await expect(svc.setSecret("a", "ai.api_key", { value: "x" })).rejects.toBeInstanceOf(SecretsUnavailableError);
    expect(m.secrets.size).toBe(0);
    expect(await svc.reveal("ai.api_key")).toBeNull();
  });

  it("D-19: payment sandbox defaults to off; where sandbox is not allowed (production) switching it on is refused, audited and stores nothing", async () => {
    expect(PLATFORM_SETTING_DEFAULTS.payment.sandbox).toBe(false);
    const m = memory();
    const prod = new PlatformSettingsService(m.repo, cipher, false);
    expect((await prod.view()).sandboxAllowed).toBe(false);
    await expect(prod.update("admin1", "payment", { zarinpalEnabled: true, aqayepardakhtEnabled: false, sandbox: true })).rejects.toBeInstanceOf(ValidationError);
    expect(m.settings.has("payment")).toBe(false);
    expect(m.audit).toEqual(["security.sandbox_refused:payment"]);
    // Everything else about payments still works in production.
    await prod.update("admin1", "payment", { zarinpalEnabled: true, aqayepardakhtEnabled: false, sandbox: false });
    expect((await prod.settings()).payment).toEqual({ zarinpalEnabled: true, aqayepardakhtEnabled: false, sandbox: false });
    // Staging, test and development may switch it on.
    const staging = new PlatformSettingsService(memory().repo, cipher, true);
    expect((await staging.update("admin1", "payment", { zarinpalEnabled: true, aqayepardakhtEnabled: false, sandbox: true })).payment.sandbox).toBe(true);
  });
});
