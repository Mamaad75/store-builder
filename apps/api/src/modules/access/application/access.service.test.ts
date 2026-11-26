import { ROLE_PERMISSIONS } from "@store-builder/shared/modules/access/permissions";
import { beforeEach, describe, expect, it } from "vitest";
import { InvitationTargetError, PermissionDeniedError, StaffLimitError, StoreSuspendedError } from "@store-builder/shared/modules/access/errors";
import { MAX_STAFF_PER_STORE, PERMISSIONS, type StaffRole } from "@store-builder/shared/modules/access/permissions";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { AccessService } from "./access.service.js";
import { DuplicateInvitationError, type AccessRepository, type AuditInput, type AuditRepository } from "./ports.js";

const NOW = new Date("2026-11-21T10:00:00Z");
interface Inv { id: string; storeId: string; invitedUserId: string; role: StaffRole; expiresAt: Date }

class Memory implements AccessRepository, AuditRepository {
  stores = new Map([["s1", "owner"], ["s2", "other"]]);
  suspended = new Set<string>();
  users = new Map([["owner", "owner"], ["ali", "u-ali"], ["sara", "u-sara"], ["other", "other"]]);
  staff: { storeId: string; userId: string; role: StaffRole }[] = [];
  invites: Inv[] = [];
  events: AuditInput[] = [];
  private seq = 0;
  async facts(storeId: string, userId: string) {
    const ownerId = this.stores.get(storeId);
    if (!ownerId) return null;
    return { ownerId, memberRole: this.staff.find((m) => m.storeId === storeId && m.userId === userId)?.role ?? null, suspended: this.suspended.has(storeId) };
  }
  async userIdByUsername(u: string) { return this.users.get(u.toLowerCase()) ?? null; }
  async isMember(s: string, u: string) { return this.staff.some((m) => m.storeId === s && m.userId === u); }
  async members() { return []; }
  async invitations() { return []; }
  async staffCount(s: string, now: Date) { return this.staff.filter((m) => m.storeId === s).length + this.invites.filter((i) => i.storeId === s && i.expiresAt > now).length; }
  async createInvitation(i: { storeId: string; invitedUserId: string; role: StaffRole; expiresAt: Date }, now: Date) {
    const old = this.invites.find((x) => x.storeId === i.storeId && x.invitedUserId === i.invitedUserId);
    if (old && old.expiresAt > now) throw new DuplicateInvitationError();
    this.invites = this.invites.filter((x) => x !== old);
    const id = `inv${++this.seq}`;
    this.invites.push({ id, ...i });
    return { id };
  }
  async myInvitations() { return []; }
  async acceptInvitation(id: string, userId: string, now: Date) {
    const inv = this.invites.find((i) => i.id === id && i.invitedUserId === userId && i.expiresAt > now);
    if (!inv) return null;
    this.invites = this.invites.filter((i) => i !== inv);
    this.staff.push({ storeId: inv.storeId, userId, role: inv.role });
    return { storeId: inv.storeId, role: inv.role };
  }
  async declineInvitation(id: string, userId: string) {
    const inv = this.invites.find((i) => i.id === id && i.invitedUserId === userId);
    if (!inv) return null;
    this.invites = this.invites.filter((i) => i !== inv);
    return { storeId: inv.storeId };
  }
  async cancelInvitation(s: string, id: string) { const n = this.invites.length; this.invites = this.invites.filter((i) => !(i.storeId === s && i.id === id)); return this.invites.length < n; }
  async removeMember(s: string, u: string) { const n = this.staff.length; this.staff = this.staff.filter((m) => !(m.storeId === s && m.userId === u)); return this.staff.length < n; }
  async changeRole(s: string, u: string, role: StaffRole) { const m = this.staff.find((x) => x.storeId === s && x.userId === u); if (m) m.role = role; return Boolean(m); }
  async sharedStores() { return []; }
  async record(e: AuditInput) { this.events.push(e); }
  async list() { return []; }
}

let mem: Memory;
let svc: AccessService;
beforeEach(() => {
  mem = new Memory();
  svc = new AccessService(mem, mem, () => NOW);
});
const ownerCtx = () => svc.resolve("owner", "s1", "members.manage");

describe("resolve: one decision per request", () => {
  it("the owner gets OWNER and acts for themself", async () => {
    expect(await svc.resolve("owner", "s1", "store.delete")).toEqual({ storeId: "s1", ownerId: "owner", actorId: "owner", role: "OWNER" });
  });
  it("a stranger and a missing or malformed store are the same NotFound (no existence leak)", async () => {
    for (const [u, s] of [["u-ali", "s1"], ["owner", "nope"], ["owner", ""], ["owner", "x".repeat(65)]]) await expect(svc.resolve(u!, s, "store.view")).rejects.toBeInstanceOf(NotFoundError);
  });
  it("staff act FOR the owner (ownerId) but are recorded as themselves (actorId); a missing permission is 403, not 404", async () => {
    mem.staff.push({ storeId: "s1", userId: "u-ali", role: "OPERATOR" });
    expect(await svc.resolve("u-ali", "s1", "catalog.write")).toEqual({ storeId: "s1", ownerId: "owner", actorId: "u-ali", role: "OPERATOR" });
    const e = await svc.resolve("u-ali", "s1", "publish").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PermissionDeniedError);
    expect((e as PermissionDeniedError).permission).toBe("publish");
  });
  it("membership is per store: a member of s1 has nothing in s2", async () => {
    mem.staff.push({ storeId: "s1", userId: "u-ali", role: "MANAGER" });
    await expect(svc.resolve("u-ali", "s2", "store.view")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("mine: what the caller may do", () => {
  it("returns the role and exactly the permissions the shared table gives it (a copy, never the shared array)", async () => {
    const owner = await svc.resolve("owner", "s1", "store.view");
    const m = svc.mine(owner);
    expect(m.role).toBe("OWNER");
    expect(m.permissions).toEqual([...ROLE_PERMISSIONS.OWNER]);
    m.permissions.pop();
    expect(ROLE_PERMISSIONS.OWNER.length).toBeGreaterThan(m.permissions.length);
    mem.staff.push({ storeId: "s1", userId: "u-ali", role: "OPERATOR" });
    const op = svc.mine(await svc.resolve("u-ali", "s1", "store.view"));
    expect([op.role, op.permissions.includes("catalog.write"), op.permissions.includes("publish"), op.permissions.includes("audit.view")]).toEqual(["OPERATOR", true, false, false]);
  });
});

describe("invitations (D23-2)", () => {
  it("invite -> accept makes the invitee a member with the invited role; both steps are audited with the real actor", async () => {
    const { id } = await svc.invite(await ownerCtx(), { username: "ALI", role: "MANAGER" });
    expect((await svc.acceptInvitation("u-ali", id)).storeId).toBe("s1");
    expect((await svc.resolve("u-ali", "s1", "publish")).role).toBe("MANAGER");
    expect(mem.events.map((e) => [e.action, e.actorId])).toEqual([["staff.invited", "owner"], ["staff.joined", "u-ali"]]);
  });
  it("nobody joins without accepting; an invitation cannot be accepted by someone else; declined means gone", async () => {
    const { id } = await svc.invite(await ownerCtx(), { username: "ali", role: "OPERATOR" });
    await expect(svc.resolve("u-ali", "s1", "store.view")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.acceptInvitation("u-sara", id)).rejects.toBeInstanceOf(NotFoundError);
    await svc.declineInvitation("u-ali", id);
    await expect(svc.acceptInvitation("u-ali", id)).rejects.toBeInstanceOf(NotFoundError);
  });
  it("refuses unknown users, yourself, the owner, existing members and a second pending invitation", async () => {
    const ctx = await ownerCtx();
    const reason = (u: string) => svc.invite(ctx, { username: u, role: "OPERATOR" }).then(() => null, (e: InvitationTargetError) => e.reason);
    expect(await reason("nobody")).toBe("unknown_user");
    expect(await reason("owner")).toBe("self");
    mem.staff.push({ storeId: "s1", userId: "u-sara", role: "OPERATOR" });
    expect(await reason("sara")).toBe("already_member");
    await svc.invite(ctx, { username: "ali", role: "OPERATOR" });
    expect(await reason("ali")).toBe("already_invited");
  });
  it("a manager inviting the owner is refused as 'owner'; invalid input is a validation error", async () => {
    mem.staff.push({ storeId: "s1", userId: "u-ali", role: "MANAGER" });
    const managerCtx = { storeId: "s1", ownerId: "owner", actorId: "u-ali", role: "MANAGER" as const };
    expect(await svc.invite(managerCtx, { username: "owner", role: "OPERATOR" }).catch((e: InvitationTargetError) => e.reason)).toBe("owner");
    await expect(svc.invite(managerCtx, { username: "sara", role: "OWNER" })).rejects.toBeInstanceOf(ValidationError);
  });
  it("members + pending invitations are capped", async () => {
    for (let i = 0; i < MAX_STAFF_PER_STORE; i++) mem.staff.push({ storeId: "s1", userId: `m${i}`, role: "OPERATOR" });
    await expect(svc.invite(await ownerCtx(), { username: "ali", role: "OPERATOR" })).rejects.toBeInstanceOf(StaffLimitError);
  });
});

describe("staff changes", () => {
  it("role change, removal and leaving are audited; the owner can never be removed (not a member row)", async () => {
    mem.staff.push({ storeId: "s1", userId: "u-ali", role: "OPERATOR" }, { storeId: "s1", userId: "u-sara", role: "OPERATOR" });
    const ctx = await ownerCtx();
    await svc.changeRole(ctx, "u-ali", { role: "MANAGER" });
    await svc.removeMember(ctx, "u-sara");
    await expect(svc.removeMember(ctx, "owner")).rejects.toBeInstanceOf(NotFoundError);
    await svc.leave("u-ali", "s1");
    await expect(svc.resolve("u-ali", "s1", "store.view")).rejects.toBeInstanceOf(NotFoundError);
    expect(mem.events.map((e) => e.action)).toEqual(["staff.role_changed", "staff.removed", "staff.left"]);
  });
});

describe("ADR 0003 (G2): a suspended store", () => {
  it("allows reads for what the role allows and only order management among writes; the role check comes first", async () => {
    mem.suspended.add("s1");
    try {
      for (const p of PERMISSIONS) {
        expect((await svc.resolve("owner", "s1", p, false)).role).toBe("OWNER"); // every read stays possible
        const w = await svc.resolve("owner", "s1", p, true).catch((x: unknown) => x);
        if (p === "orders.manage" || p === "support.write") expect(w).toMatchObject({ role: "OWNER" });
        else expect(w).toBeInstanceOf(StoreSuspendedError);
      }
      expect(((await svc.resolve("owner", "s1", "publish").catch((x: unknown) => x)) as StoreSuspendedError).code).toBe("STORE_SUSPENDED");
      // a stranger still gets 404 and a staff member without the permission still gets PermissionDenied (no state leak)
      await expect(svc.resolve("u-sara", "s1", "publish")).rejects.toBeInstanceOf(NotFoundError);
      mem.staff.push({ storeId: "s1", userId: "u-ali", role: "OPERATOR" });
      await expect(svc.resolve("u-ali", "s1", "publish")).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(svc.resolve("u-ali", "s1", "catalog.write")).rejects.toBeInstanceOf(StoreSuspendedError);
      expect((await svc.resolve("u-ali", "s1", "catalog.write", false)).role).toBe("OPERATOR");
      // other stores of the same platform are unaffected
      expect((await svc.resolve("other", "s2", "publish")).role).toBe("OWNER");
    } finally {
      mem.suspended.delete("s1");
    }
  });
});
