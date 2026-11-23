import { describe, expect, it } from "vitest";
import { PlatformAdminConflictError, PlatformForbiddenError } from "@store-builder/shared/modules/platform/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { PlatformService } from "./platform.service.js";
import type { PlatformRepository } from "./ports.js";

function memory() {
  const users = new Map([["u1", "ali"], ["u2", "sara"], ["u3", "reza"]]);
  const admins = new Map<string, Date>();
  const audit: string[] = [];
  const repo: PlatformRepository = {
    roleOf: async (id) => (admins.has(id) ? "SUPER_ADMIN" : null),
    admins: async () => [...admins].map(([userId, grantedAt]) => ({ userId, username: users.get(userId)!, name: users.get(userId)!, role: "SUPER_ADMIN" as const, grantedAt })),
    countAdmins: async () => admins.size,
    userIdByUsername: async (u) => [...users].find(([, n]) => n === u)?.[0] ?? null,
    grant: async (id, _r, a) => {
      if (a.actorId && !admins.has(a.actorId)) return "forbidden";
      if (admins.has(id)) return "exists";
      admins.set(id, new Date(0));
      audit.push(`${a.action}:${a.actorId ?? "cli"}:${a.targetId}`);
      return "ok";
    },
    revoke: async (id, a) => {
      if (a.actorId && !admins.has(a.actorId)) return "forbidden";
      if (!admins.has(id)) return "missing";
      if (admins.size <= 1) return "last_admin";
      admins.delete(id);
      audit.push(`${a.action}:${a.actorId ?? "cli"}:${a.targetId}`);
      return "ok";
    },
    overview: async () => ({ users: users.size, stores: 0, publishedStores: 0, products: 0, customers: 0 }),
    stores: async () => [],
  };
  return { svc: new PlatformService(repo), audit };
}

describe("platform administration (phase 3.1)", () => {
  it("the first super admin comes from the server command; then admins grant others, audited with the real actor", async () => {
    const m = memory();
    await m.svc.grant(null, { username: " ALI " }); // normalised like sign-in
    await m.svc.grant("u1", { username: "sara" });
    expect(m.audit).toEqual(["platform.admin_granted:cli:u1", "platform.admin_granted:u1:u2"]);
    expect(await m.svc.roleOf("u2")).toBe("SUPER_ADMIN");
    expect(await m.svc.roleOf("u3")).toBeNull();
  });

  it("refuses: a second grant, an unknown user, bad input, revoking oneself or the last admin", async () => {
    const m = memory();
    await m.svc.grant(null, { username: "ali" });
    await expect(m.svc.grant("u1", { username: "ali" })).rejects.toBeInstanceOf(PlatformAdminConflictError);
    await expect(m.svc.grant("u1", { username: "nobody" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(m.svc.grant("u1", { username: 5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(m.svc.revoke("u1", "u1")).rejects.toMatchObject({ reason: "self" });
    await expect(m.svc.revoke(null, "u1")).rejects.toMatchObject({ reason: "last_admin" });
    await m.svc.grant("u1", { username: "sara" });
    await m.svc.revoke("u2", "u1");
    expect(await m.svc.roleOf("u1")).toBeNull();
    await expect(m.svc.revoke("u2", "u3")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("security review 2026-11-23: an actor revoked meanwhile can neither grant nor revoke (re-checked under the lock)", async () => {
    const m = memory();
    await m.svc.grant(null, { username: "ali" });
    await m.svc.grant("u1", { username: "sara" });
    await m.svc.revoke("u1", "u2"); // sara is no longer an admin
    await expect(m.svc.grant("u2", { username: "reza" })).rejects.toBeInstanceOf(PlatformForbiddenError);
    await expect(m.svc.revoke("u2", "u1")).rejects.toBeInstanceOf(PlatformForbiddenError);
  });

  it("validates store paging", async () => {
    const m = memory();
    for (const bad of [{ limit: "0" }, { limit: "x" }, { before: "nope" }]) await expect(m.svc.stores(bad)).rejects.toBeInstanceOf(ValidationError);
    expect(await m.svc.stores({})).toEqual([]);
  });
});
