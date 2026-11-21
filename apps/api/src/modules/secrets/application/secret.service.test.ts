import { describe, expect, it } from "vitest";
import { SecretLimitError, SecretsUnavailableError } from "@store-builder/shared/modules/secrets/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { MAX_SECRETS_PER_STORE } from "../domain/secret.js";
import { SecretService } from "./secret.service.js";
import type { AuditEntry, SealedSecret, SecretCipher, SecretRepository } from "./ports.js";

/** A fake cipher that is reversible but visibly NOT the plaintext, and checks the context like the real one. */
const cipher: SecretCipher = {
  seal: (context, value) => ({ keyId: "k1", wrappedKey: new Uint8Array(60), sealed: new TextEncoder().encode(`${context}#${[...value].reverse().join("")}`) }),
  open: (context, e) => {
    const [ctx, body] = new TextDecoder().decode(e.sealed).split("#");
    if (ctx !== context) throw new Error("context mismatch");
    return [...body!].reverse().join("");
  },
};

/** Same contract as the Prisma repository: cap and audit are part of the write itself. */
function memory() {
  const rows = new Map<string, { e: SealedSecret; hint: string | null }>();
  const events: string[] = [];
  const k = (s: string, n: string) => `${s}/${n}`;
  const mine = (s: string) => [...rows.entries()].filter(([key]) => key.startsWith(`${s}/`));
  const repo: SecretRepository = {
    list: async (s) => mine(s).map(([key, v]) => ({ name: key.split("/")[1]!, hint: v.hint, updatedAt: new Date(0) })),
    get: async (s, n) => rows.get(k(s, n))?.e ?? null,
    put: async (s, n, e, hint, o: { limit: number; audit: AuditEntry }) => {
      if (!rows.has(k(s, n)) && mine(s).length >= o.limit) return "limit";
      rows.set(k(s, n), { e, hint });
      events.push(`${o.audit.action}:${o.audit.actorId}`);
      return "ok";
    },
    remove: async (s, n, audit) => {
      if (!rows.delete(k(s, n))) return false;
      events.push(`${audit.action}:${audit.actorId}`);
      return true;
    },
  };
  return { repo, events };
}
const A = { storeId: "s1", actorId: "owner" };
const NAME = "payment.zarinpal.merchant_id";
const LONG = "zp-merchant-0000-1111-2222-ABCD"; // 31 characters: gets a hint

describe("SecretService (in-memory ports)", () => {
  it("set stores only the envelope; list shows the name and a masked hint, never the value; reveal is server-side", async () => {
    const m = memory();
    const svc = new SecretService(m.repo, cipher);
    await svc.set(A, NAME, { value: `  ${LONG}\n` });
    expect(JSON.stringify(await svc.list(A))).not.toContain("zp-merchant");
    expect(await svc.list(A)).toEqual({ configured: true, secrets: [{ name: NAME, hint: "ABCD", updatedAt: new Date(0) }] });
    expect(await svc.reveal("s1", NAME)).toBe(LONG); // trimmed
    expect(await svc.reveal("s1", "payment.other.key")).toBeNull();
    expect(m.events).toEqual(["secret.set:owner"]);
  });

  it("invalid names are 404; invalid values (empty, blank, too long, control/format/bidi characters) are a validation error that never echoes the input", async () => {
    const svc = new SecretService(memory().repo, cipher);
    await expect(svc.set(A, "../x", { value: "v" })).rejects.toBeInstanceOf(NotFoundError);
    const bad = ["", "   ", "x".repeat(5000), "a\u0000b", "a\u007fb", "a\u0085b", "a​b", "a‮b", "a\ud800b"];
    for (const value of [...bad.map((v) => ({ value: v })), { value: 5 }, { value: "ok", extra: 1 }]) {
      const e = await svc.set(A, NAME, value).catch((x: unknown) => x);
      expect(e, JSON.stringify(value).slice(0, 30)).toBeInstanceOf(ValidationError);
      expect(JSON.stringify((e as ValidationError).fieldErrors)).not.toContain("xxxxx");
    }
  });

  it("without master keys the feature is off: listing works (configured: false), setting and revealing refuse", async () => {
    const svc = new SecretService(memory().repo, null);
    expect((await svc.list(A)).configured).toBe(false);
    await expect(svc.set(A, NAME, { value: "abc" })).rejects.toBeInstanceOf(SecretsUnavailableError);
    await expect(svc.reveal("s1", NAME)).rejects.toBeInstanceOf(SecretsUnavailableError);
  });

  it("caps the number of secrets per store; replacing an existing one is always allowed", async () => {
    const m = memory();
    const svc = new SecretService(m.repo, cipher);
    for (let i = 0; i < MAX_SECRETS_PER_STORE; i++) await svc.set(A, `a.k${i}`, { value: "v" });
    await expect(svc.set(A, "a.extra", { value: "v" })).rejects.toBeInstanceOf(SecretLimitError);
    await svc.set(A, "a.k0", { value: "new" });
    expect(await svc.reveal("s1", "a.k0")).toBe("new");
  });

  it("delete removes and audits; deleting a missing secret is 404 and audits nothing", async () => {
    const m = memory();
    const svc = new SecretService(m.repo, cipher);
    await svc.set(A, NAME, { value: "v" });
    await svc.remove(A, NAME);
    await expect(svc.remove(A, NAME)).rejects.toBeInstanceOf(NotFoundError);
    expect(m.events).toEqual(["secret.set:owner", "secret.deleted:owner"]);
  });
});
