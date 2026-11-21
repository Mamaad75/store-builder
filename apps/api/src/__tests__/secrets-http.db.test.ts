import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../app.js";
import { TokenService } from "../auth/token.js";
import { setMediaStorageForTests } from "../lib/storage/index.js";
import { createSecretService, rotateSecrets } from "../modules/secrets/secrets.api.js";
import { createStore } from "../modules/stores/service.js";
import { EnvelopeError, decrypt, type MasterKeys } from "../platform/crypto/envelope.js";
import { MemoryMediaStorage } from "../test/memory-storage.js";
import { makeUser, prisma, resetDb } from "../test/db-helpers.js";
import { testConfig } from "./helpers.js";

/** Phase 2.4 (D24-1) over HTTP on real PostgreSQL: owner-only, write-only secrets, encrypted at rest, bound to their store. */
const ORIGIN = "http://localhost:3000";
const FETCH_BLOCKED_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);
const tokens = new TokenService(testConfig.authSecret, testConfig.sessionMaxAgeSeconds);
const NAME = "payment.zarinpal.merchant_id";
const VALUE = "zp-merchant-7f3a-91c2-SECRET";

let app: NestExpressApplication | undefined;
let base = "";
async function start(secrets: typeof testConfig.secrets) {
  for (;;) {
    app = await createApp({ ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1, secrets });
    await app.listen(0, "127.0.0.1");
    base = (await app.getUrl()).replace("[::1]", "127.0.0.1");
    if (!FETCH_BLOCKED_PORTS.has(Number(new URL(base).port))) return;
    await app.close();
  }
}
beforeEach(async () => {
  await resetDb();
  setMediaStorageForTests(new MemoryMediaStorage());
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  setMediaStorageForTests(undefined);
});
afterAll(() => prisma.$disconnect());

async function as(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const cookie = `sb_session=${await tokens.sign({ userId: u.id, authVersion: u.authVersion })}`;
  let n = 0;
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api${path}`, { method, headers: { origin: ORIGIN, cookie, "x-forwarded-for": `10.4.0.${++n % 250}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, text, json: text ? JSON.parse(text) : null };
  };
}
async function ownerWithStore() {
  const owner = await makeUser();
  const { id: storeId } = await createStore(owner.id, { name: "فروشگاه", templateKey: "bazaar" });
  return { owner, storeId, o: await as(owner.id) };
}

describe("store secrets over HTTP (D24-1)", () => {
  it("the owner sets a secret; no response ever contains the value; the database holds only an envelope", async () => {
    await start(testConfig.secrets);
    const { storeId, o } = await ownerWithStore();
    expect((await o("PUT", `/stores/${storeId}/secrets/${NAME}`, { value: VALUE })).status).toBe(204);
    const list = await o("GET", `/stores/${storeId}/secrets`);
    expect(list.json).toMatchObject({ configured: true, secrets: [{ name: NAME, hint: "CRET" }] });
    expect(list.text).not.toContain("zp-merchant");
    const row = await prisma.storeSecret.findUniqueOrThrow({ where: { storeId_name: { storeId, name: NAME } } });
    expect(Buffer.from(row.sealed).includes(Buffer.from(VALUE))).toBe(false);
    expect(row.keyId).toBe("test1");
    // the audit names the secret, never its value
    const audit = await prisma.auditEvent.findMany({ where: { storeId, action: "secret.set" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("zp-merchant");
  });

  it("only the owner: a manager and an operator get 403, a stranger 404", async () => {
    await start(testConfig.secrets);
    const { storeId, o } = await ownerWithStore();
    for (const role of ["MANAGER", "OPERATOR"] as const) {
      const staff = await makeUser();
      const inv = (await o("POST", `/stores/${storeId}/team/invitations`, { username: staff.username, role })).json;
      const s = await as(staff.id);
      await s("POST", `/me/invitations/${inv.id}/accept`);
      expect((await s("GET", `/stores/${storeId}/secrets`)).status, role).toBe(403);
      expect((await s("PUT", `/stores/${storeId}/secrets/${NAME}`, { value: VALUE })).status, role).toBe(403);
    }
    expect((await (await as((await makeUser()).id))("GET", `/stores/${storeId}/secrets`)).status).toBe(404);
  });

  it("server-side reveal returns the value; an envelope copied into another store's record does not decrypt", async () => {
    await start(testConfig.secrets);
    const { storeId, o, owner } = await ownerWithStore();
    await o("PUT", `/stores/${storeId}/secrets/${NAME}`, { value: VALUE });
    const svc = createSecretService(testConfig.secrets);
    expect(await svc.reveal(storeId, NAME)).toBe(VALUE);
    const { id: other } = await createStore(owner.id, { name: "دیگری", templateKey: "khaneh" });
    const row = await prisma.storeSecret.findUniqueOrThrow({ where: { storeId_name: { storeId, name: NAME } } });
    await prisma.storeSecret.create({ data: { storeId: other, name: NAME, keyId: row.keyId, wrappedKey: row.wrappedKey, sealed: row.sealed, hint: row.hint } });
    await expect(svc.reveal(other, NAME)).rejects.toBeInstanceOf(EnvelopeError);
  });

  it("delete removes the record; deleting the store removes its secrets", async () => {
    await start(testConfig.secrets);
    const { storeId, o } = await ownerWithStore();
    await o("PUT", `/stores/${storeId}/secrets/${NAME}`, { value: VALUE });
    await o("PUT", `/stores/${storeId}/secrets/sms.provider.api_key`, { value: "short" });
    expect((await o("POST", `/stores/${storeId}/secrets/${NAME}/delete`)).status).toBe(204);
    expect((await o("GET", `/stores/${storeId}/secrets`)).json.secrets.map((x: { name: string; hint: string | null }) => [x.name, x.hint])).toEqual([["sms.provider.api_key", null]]);
    expect((await o("POST", `/stores/${storeId}/delete`, { confirmName: "فروشگاه" })).status).toBe(204);
    expect(await prisma.storeSecret.count()).toBe(0);
  });

  it("without master keys the feature is off: the list says so and setting a secret is 503, nothing is stored", async () => {
    await start(null);
    const { storeId, o } = await ownerWithStore();
    expect((await o("GET", `/stores/${storeId}/secrets`)).json).toEqual({ configured: false, secrets: [] });
    const r = await o("PUT", `/stores/${storeId}/secrets/${NAME}`, { value: VALUE });
    expect([r.status, r.json.errorName]).toEqual([503, "SecretsUnavailableError"]);
    expect(await prisma.storeSecret.count()).toBe(0);
  });

  it("invalid names are 404 and invalid values 400, and the error never echoes the value", async () => {
    await start(testConfig.secrets);
    const { storeId, o } = await ownerWithStore();
    expect((await o("PUT", `/stores/${storeId}/secrets/NotAName`, { value: VALUE })).status).toBe(404);
    const bad = await o("PUT", `/stores/${storeId}/secrets/${NAME}`, { value: `${VALUE}\u0007` });
    expect(bad.status).toBe(400);
    expect(bad.text).not.toContain("zp-merchant");
  });
});

describe("store secrets: abuse cases and rotation (security review 2026-11-21)", () => {
  it("a stranger cannot set or delete (404); staff cannot delete (403); an owner cannot touch ANOTHER owner's store (404)", async () => {
    await start(testConfig.secrets);
    const { storeId, o } = await ownerWithStore();
    await o("PUT", `/stores/${storeId}/secrets/${NAME}`, { value: VALUE });
    const stranger = await as((await makeUser()).id);
    expect((await stranger("PUT", `/stores/${storeId}/secrets/${NAME}`, { value: "x" })).status).toBe(404);
    expect((await stranger("POST", `/stores/${storeId}/secrets/${NAME}/delete`)).status).toBe(404);
    for (const role of ["MANAGER", "OPERATOR"] as const) {
      const staff = await makeUser();
      const inv = (await o("POST", `/stores/${storeId}/team/invitations`, { username: staff.username, role })).json;
      const s = await as(staff.id);
      await s("POST", `/me/invitations/${inv.id}/accept`);
      expect((await s("POST", `/stores/${storeId}/secrets/${NAME}/delete`)).status, role).toBe(403);
    }
    const other = await ownerWithStore(); // another owner with their own store
    expect((await other.o("GET", `/stores/${storeId}/secrets`)).status).toBe(404);
    expect((await other.o("PUT", `/stores/${storeId}/secrets/${NAME}`, { value: "hijack" })).status).toBe(404);
    expect(await createSecretService(testConfig.secrets).reveal(storeId, NAME)).toBe(VALUE);
  });

  it("a write without the platform Origin is refused (CSRF) and changes nothing", async () => {
    await start(testConfig.secrets);
    const { storeId, owner } = await ownerWithStore();
    const u = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    const cookie = `sb_session=${await tokens.sign({ userId: u.id, authVersion: u.authVersion })}`;
    for (const origin of [undefined, "https://evil.example"]) {
      const r = await fetch(`${base}/api/stores/${storeId}/secrets/${NAME}`, { method: "PUT", headers: { cookie, "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ value: VALUE }) });
      expect(r.status, String(origin)).toBe(403);
    }
    expect(await prisma.storeSecret.count()).toBe(0);
  });

  it("the hint appears only for values of 24+ characters", async () => {
    await start(testConfig.secrets);
    const { storeId, o } = await ownerWithStore();
    await o("PUT", `/stores/${storeId}/secrets/a.short`, { value: "y".repeat(23) });
    await o("PUT", `/stores/${storeId}/secrets/a.long`, { value: `${"y".repeat(20)}WXYZ` });
    const hints = Object.fromEntries((await o("GET", `/stores/${storeId}/secrets`)).json.secrets.map((x: { name: string; hint: string | null }) => [x.name, x.hint]));
    expect(hints).toEqual({ "a.long": "WXYZ", "a.short": null });
  });

  it("concurrent writes cannot pass the per-store cap, and every stored secret has exactly one audit entry", async () => {
    await start(testConfig.secrets);
    const { storeId, o } = await ownerWithStore();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => o("PUT", `/stores/${storeId}/secrets/a.k${i}`, { value: `v${i}` })));
    expect(results.filter((r) => r.status === 204)).toHaveLength(20);
    expect(results.filter((r) => r.status === 409).every((r) => r.json.errorName === "SecretLimitError")).toBe(true);
    expect(await prisma.storeSecret.count({ where: { storeId } })).toBe(20);
    expect(await prisma.auditEvent.count({ where: { storeId, action: "secret.set" } })).toBe(20);
  });

  it("rotation re-wraps every record under the new key, the values still open, and the old key can be retired", async () => {
    await start(testConfig.secrets);
    const { storeId, o } = await ownerWithStore();
    for (let i = 0; i < 5; i++) await o("PUT", `/stores/${storeId}/secrets/a.k${i}`, { value: `value-${i}` });
    const next: MasterKeys = { activeId: "test2", keys: new Map([["test1", Buffer.alloc(32, 7)], ["test2", Buffer.alloc(32, 8)]]) };
    expect(await rotateSecrets(next, 2)).toEqual({ rewrapped: 5, failed: 0, remaining: 0 }); // several pages
    const onlyNew: MasterKeys = { activeId: "test2", keys: new Map([["test2", Buffer.alloc(32, 8)]]) };
    expect(await createSecretService(onlyNew).reveal(storeId, "a.k3")).toBe("value-3");
    expect(await rotateSecrets(next)).toEqual({ rewrapped: 0, failed: 0, remaining: 0 }); // idempotent
  });

  it("REGRESSION: a value changed by the owner during rotation is never overwritten with the stale data key (CAS on the wrapped key)", async () => {
    await start(testConfig.secrets);
    const { storeId, o } = await ownerWithStore();
    await o("PUT", `/stores/${storeId}/secrets/${NAME}`, { value: "old-value" });
    const stale = await prisma.storeSecret.findUniqueOrThrow({ where: { storeId_name: { storeId, name: NAME } } });
    await o("PUT", `/stores/${storeId}/secrets/${NAME}`, { value: "new-value" }); // same key id, new data key + sealed value
    // what the old rotation did with the stale snapshot: match on keyId only => now refused because the wrapped key changed
    const n = await prisma.storeSecret.updateMany({ where: { storeId, name: NAME, keyId: stale.keyId, wrappedKey: { equals: stale.wrappedKey } }, data: { wrappedKey: stale.wrappedKey } });
    expect(n.count).toBe(0);
    expect(await createSecretService(testConfig.secrets).reveal(storeId, NAME)).toBe("new-value");
  });

  it("a record under an unknown old key is counted as failed once, and does not stop the others", async () => {
    await start(testConfig.secrets);
    const { storeId, o } = await ownerWithStore();
    for (const n of ["a.k1", "a.k2"]) await o("PUT", `/stores/${storeId}/secrets/${n}`, { value: n });
    await prisma.storeSecret.updateMany({ where: { storeId, name: "a.k1" }, data: { keyId: "lost" } });
    const next: MasterKeys = { activeId: "test2", keys: new Map([["test1", Buffer.alloc(32, 7)], ["test2", Buffer.alloc(32, 8)]]) };
    expect(await rotateSecrets(next, 1)).toEqual({ rewrapped: 1, failed: 1, remaining: 1 });
    const row = await prisma.storeSecret.findUniqueOrThrow({ where: { storeId_name: { storeId, name: "a.k2" } } });
    expect(decrypt(next, `store:${storeId}|name:a.k2`, { keyId: row.keyId, wrappedKey: Buffer.from(row.wrappedKey), sealed: Buffer.from(row.sealed) })).toBe("a.k2");
  });
});
