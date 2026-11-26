import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { createApp } from "../app.js";
import { TokenService } from "../auth/token.js";
import { setMediaStorageForTests } from "../lib/storage/index.js";
import { createStore } from "../modules/stores/service.js";
import { MemoryMediaStorage } from "../test/memory-storage.js";
import { makeUser, prisma, resetDb } from "../test/db-helpers.js";
import { testConfig } from "./helpers.js";

/** Phase 2.3 (D23-1..3) over HTTP on real PostgreSQL: the real guard, real roles, real invitations and the audit log. */
const ORIGIN = "http://localhost:3000";
const config = { ...testConfig, databaseUrl: process.env.DATABASE_URL!, trustProxyHops: 1 };
const tokens = new TokenService(config.authSecret, config.sessionMaxAgeSeconds);

let app: NestExpressApplication | undefined;
let base = "";
beforeEach(async () => {
  await resetDb();
  await prisma.$executeRawUnsafe(`TRUNCATE "AuditEvent", "StoreInvitation", "StoreMember" CASCADE`);
  setMediaStorageForTests(new MemoryMediaStorage());
  // A random port can land on fetch's blocked-port list (1719, 6000, 6665-6669, 10080, ...): fetch then refuses with "bad port".
  for (;;) {
    app = await createApp(config);
    await app.listen(0, "127.0.0.1");
    base = (await app.getUrl()).replace("[::1]", "127.0.0.1");
    if (!FETCH_BLOCKED_PORTS.has(Number(new URL(base).port))) break;
    await app.close();
  }
});
const FETCH_BLOCKED_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);
afterEach(async () => {
  await app?.close();
  app = undefined;
  setMediaStorageForTests(undefined);
});
afterAll(() => prisma.$disconnect());

type Res = { status: number; json: any };
async function as(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const cookie = `sb_session=${await tokens.sign({ userId: u.id, authVersion: u.authVersion })}`;
  let n = 0;
  return async (method: string, path: string, body?: unknown): Promise<Res> => {
    const headers: Record<string, string> = { origin: ORIGIN, cookie, "x-forwarded-for": `10.3.0.${++n % 250}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) };
    const res = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
}

/** An owner with a store, and a second account joined as `role` through a real invite + accept. */
async function team(role: "MANAGER" | "OPERATOR") {
  const owner = await makeUser();
  const staff = await makeUser();
  const { id: storeId } = await createStore(owner.id, { name: "فروشگاه تیمی", templateKey: "bazaar" });
  const o = await as(owner.id);
  const s = await as(staff.id);
  const inv = await o("POST", `/stores/${storeId}/team/invitations`, { username: staff.username, role });
  expect(inv.status).toBe(201);
  expect((await s("GET", "/me/invitations")).json).toMatchObject([{ id: inv.json.id, storeId, role }]);
  expect((await s("POST", `/me/invitations/${inv.json.id}/accept`)).status).toBe(200);
  return { owner, staff, storeId, o, s };
}
const product = { name: "چای سبز", price: 125000, stockQuantity: 5 };

describe("roles over HTTP (D23-1)", () => {
  it("an OPERATOR works on the catalog of the owner's store but cannot publish, change settings, delete, manage staff or read the audit log", async () => {
    const { storeId, s, owner } = await team("OPERATOR");
    expect((await s("GET", `/stores/${storeId}`)).status).toBe(200);
    const p = await s("POST", `/stores/${storeId}/products`, product);
    expect(p.status).toBe(201);
    // the product belongs to the OWNER's store (the operator acts for the owner)
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.json.id }, include: { store: true } })).store.ownerId).toBe(owner.id);
    for (const [m, path, body] of [
      ["POST", `/stores/${storeId}/publish`, { expectedDraftRevision: 1 }],
      ["PATCH", `/stores/${storeId}`, { name: "x" }],
      ["POST", `/stores/${storeId}/delete`, { confirmName: "فروشگاه تیمی" }],
      ["GET", `/stores/${storeId}/team`, undefined],
      ["GET", `/stores/${storeId}/audit`, undefined],
      ["POST", `/stores/${storeId}/themes/switch`, { key: "circuit" }],
    ] as const) {
      const r = await s(m, path, body);
      expect(r.status, `${m} ${path}`).toBe(403);
      expect(r.json.errorName).toBe("PermissionDeniedError");
    }
    expect(await prisma.store.count({ where: { id: storeId } })).toBe(1);
  });

  it("a MANAGER can change settings and read the audit log, but cannot delete the store or manage staff", async () => {
    const { storeId, s } = await team("MANAGER");
    expect((await s("PATCH", `/stores/${storeId}`, { name: "نام تازه" })).status).toBe(200);
    expect((await s("GET", `/stores/${storeId}/audit`)).status).toBe(200);
    expect((await s("GET", `/stores/${storeId}/team`)).status).toBe(403);
    expect((await s("POST", `/stores/${storeId}/delete`, { confirmName: "نام تازه" })).status).toBe(403);
  });

  it("a stranger sees a foreign store exactly like a missing one (404), on every kind of route", async () => {
    const { storeId } = await team("OPERATOR");
    const x = await as((await makeUser()).id);
    for (const path of [`/stores/${storeId}`, `/stores/${storeId}/products`, `/stores/${storeId}/team`, `/stores/${storeId}/audit`, "/stores/does-not-exist"]) {
      const r = await x("GET", path);
      expect(r.status, path).toBe(404);
    }
  });

  it("membership is per store: staff of one store have nothing in the owner's other store", async () => {
    const { owner, s } = await team("MANAGER");
    const { id: other } = await createStore(owner.id, { name: "دیگری", templateKey: "khaneh" });
    expect((await s("GET", `/stores/${other}`)).status).toBe(404);
  });
});

describe("my access (the dashboard shows only what a role can use)", () => {
  it("GET /stores/:id/access gives each role exactly its permissions; a stranger gets 404", async () => {
    const { storeId, owner, o, s } = await team("OPERATOR");
    expect((await o("GET", `/stores/${storeId}/access`)).json).toMatchObject({ role: "OWNER", permissions: expect.arrayContaining(["members.manage", "audit.view", "publish"]) });
    const op = (await s("GET", `/stores/${storeId}/access`)).json;
    expect(op.role).toBe("OPERATOR");
    expect(op.permissions).toEqual(expect.arrayContaining(["store.view", "catalog.write"]));
    for (const no of ["publish", "members.manage", "audit.view", "orders.view", "store.settings"]) expect(op.permissions).not.toContain(no);
    const manager = await team("MANAGER");
    const m = (await manager.s("GET", `/stores/${manager.storeId}/access`)).json;
    expect(m.role).toBe("MANAGER");
    expect(m.permissions).toEqual(expect.arrayContaining(["audit.view", "orders.view"]));
    expect(m.permissions).not.toContain("members.manage");
    const stranger = await as((await makeUser()).id);
    expect((await stranger("GET", `/stores/${storeId}/access`)).status).toBe(404);
    void owner;
  });
});

describe("invitations and staff changes (D23-2)", () => {
  it("nobody joins without accepting; an invitation cannot be accepted by someone else or after it expired", async () => {
    const owner = await makeUser();
    const ali = await makeUser();
    const eve = await makeUser();
    const { id: storeId } = await createStore(owner.id, { name: "فروشگاه", templateKey: "bazaar" });
    const o = await as(owner.id);
    const inv = (await o("POST", `/stores/${storeId}/team/invitations`, { username: ali.username, role: "OPERATOR" })).json;
    const a = await as(ali.id);
    expect((await a("GET", `/stores/${storeId}`)).status).toBe(404); // invited is not a member
    expect((await (await as(eve.id))("POST", `/me/invitations/${inv.id}/accept`)).status).toBe(404);
    await prisma.storeInvitation.update({ where: { id: inv.id }, data: { createdAt: new Date(Date.now() - 20 * 86_400_000), expiresAt: new Date(Date.now() - 86_400_000) } });
    expect((await a("POST", `/me/invitations/${inv.id}/accept`)).status).toBe(404);
    expect(await prisma.storeMember.count()).toBe(0);
  });

  it("invitation refusals are reported precisely; a second pending invitation is refused", async () => {
    const owner = await makeUser();
    const ali = await makeUser();
    const { id: storeId } = await createStore(owner.id, { name: "فروشگاه", templateKey: "bazaar" });
    const o = await as(owner.id);
    const reason = async (username: string) => (await o("POST", `/stores/${storeId}/team/invitations`, { username, role: "OPERATOR" })).json?.payload?.reason ?? null;
    expect(await reason("no_such_user")).toBe("unknown_user");
    expect(await reason(owner.username)).toBe("self");
    expect(await reason(ali.username)).toBeNull();
    expect(await reason(ali.username)).toBe("already_invited");
  });

  it("removing a member ends their access at once; the owner can see and change the team; a member can leave", async () => {
    const { storeId, o, s, staff } = await team("OPERATOR");
    const t = (await o("GET", `/stores/${storeId}/team`)).json;
    expect(t.members.map((m: { role: string }) => m.role)).toEqual(["OWNER", "OPERATOR"]);
    expect((await o("PATCH", `/stores/${storeId}/team/members/${staff.id}`, { role: "MANAGER" })).status).toBe(204);
    expect((await s("GET", `/stores/${storeId}/audit`)).status).toBe(200); // now a manager
    expect((await o("POST", `/stores/${storeId}/team/members/${staff.id}/remove`)).status).toBe(204);
    expect((await s("GET", `/stores/${storeId}`)).status).toBe(404);
    expect((await s("GET", "/me/shared-stores")).json).toEqual([]);
  });

  it("the member sees the store among their shared stores, and leaving removes it", async () => {
    const { storeId, s } = await team("MANAGER");
    expect((await s("GET", "/me/shared-stores")).json).toEqual([{ storeId, name: "فروشگاه تیمی", role: "MANAGER" }]);
    expect((await s("POST", `/me/memberships/${storeId}/leave`)).status).toBe(204);
    expect((await s("GET", `/stores/${storeId}`)).status).toBe(404);
  });

  it("deleting the store removes its staff and invitations (cascade)", async () => {
    const { storeId, o } = await team("OPERATOR");
    expect((await o("POST", `/stores/${storeId}/delete`, { confirmName: "فروشگاه تیمی" })).status).toBe(204);
    expect(await prisma.storeMember.count()).toBe(0);
  });
});

describe("audit log (D23-3)", () => {
  it("records sensitive writes with the REAL actor (the staff member, not the owner) and serves them newest first to owner and manager", async () => {
    const { storeId, o, s, staff } = await team("OPERATOR");
    await s("POST", `/stores/${storeId}/products`, product);
    await o("PATCH", `/stores/${storeId}`, { name: "نام تازه" });
    const log = (await o("GET", `/stores/${storeId}/audit`)).json as { action: string; actorUsername: string }[];
    expect(log.map((e) => e.action)).toEqual(["store.settings_updated", "product.created", "staff.joined", "staff.invited"]);
    expect(log[1]!.actorUsername).toBe(staff.username);
    // reads are not audited, refused calls are not audited
    await s("GET", `/stores/${storeId}/products`);
    await s("PATCH", `/stores/${storeId}`, { name: "ممنوع" });
    expect(await prisma.auditEvent.count({ where: { storeId } })).toBe(4);
  });

  it("the audit list is bounded and paginates with a cursor", async () => {
    const { storeId, o } = await team("OPERATOR");
    for (let i = 0; i < 5; i++) await o("POST", `/stores/${storeId}/products`, { ...product, name: `محصول ${i}` });
    const first = (await o("GET", `/stores/${storeId}/audit?limit=3`)).json as { createdAt: string }[];
    expect(first).toHaveLength(3);
    const next = (await o("GET", `/stores/${storeId}/audit?limit=3&before=${encodeURIComponent(first[2]!.createdAt)}`)).json as unknown[];
    expect(next.length).toBeGreaterThan(0);
  });
});
