import { z } from "zod";
import { InvitationTargetError, PermissionDeniedError, StaffLimitError, StoreSuspendedError } from "@store-builder/shared/modules/access/errors";
import { MAX_STAFF_PER_STORE, allowedWhileSuspended, can, type Permission } from "@store-builder/shared/modules/access/permissions";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { storeIdSchema } from "@store-builder/shared/modules/stores/schemas";
import { inviteSchema, roleSchema } from "@store-builder/shared/modules/access/schemas";
import { invitationExpiry, inviteRefusal, roleOf } from "../domain/access.js";
import {
  DuplicateInvitationError,
  type AccessRepository,
  type AuditInput,
  type AuditRepository,
  type AuditView,
  type InvitationView,
  type MemberView,
  type MyInvitationView,
  type SharedStoreView,
  type StoreAccessContext,
} from "./ports.js";

const idOrNotFound = (v: unknown): string => {
  const r = storeIdSchema.safeParse(v);
  if (!r.success) throw new NotFoundError();
  return r.data;
};

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.flatten().fieldErrors as Record<string, string[]>);
  return r.data;
}

/**
 * Store access (phase 2.3, D23-1..3). `resolve` is the one decision point every store route goes through (StoreAccessGuard): a user
 * without any role gets NotFoundError (exactly like a missing store, no existence leak), a member without the permission gets
 * PermissionDeniedError. Staff management and the audit log live here too; every change is audited with the REAL actor.
 */
export class AccessService {
  constructor(
    private readonly repo: AccessRepository,
    private readonly audit: AuditRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * `write` = the request changes something (any method but GET/HEAD). ADR 0003: on a suspended store, writes other than managing existing
   * orders are refused with StoreSuspendedError (after the role check, so a member without the permission still gets PermissionDenied and a
   * stranger still gets 404).
   */
  async resolve(userId: string, storeId: unknown, permission: Permission, write = true): Promise<StoreAccessContext> {
    const sid = idOrNotFound(storeId);
    const facts = await this.repo.facts(sid, userId);
    const role = facts ? roleOf(facts, userId) : null;
    if (!facts || !role) throw new NotFoundError();
    if (!can(role, permission)) throw new PermissionDeniedError(permission);
    if (facts.suspended && !allowedWhileSuspended(permission, write)) throw new StoreSuspendedError();
    return { storeId: sid, ownerId: facts.ownerId, actorId: userId, role };
  }

  record(e: AuditInput): Promise<void> {
    return this.audit.record(e);
  }

  // ---- staff (members.manage) ----

  async team(a: StoreAccessContext): Promise<{ members: MemberView[]; invitations: InvitationView[] }> {
    return { members: await this.repo.members(a.storeId), invitations: await this.repo.invitations(a.storeId, this.now()) };
  }

  async invite(a: StoreAccessContext, input: unknown): Promise<{ id: string }> {
    const { username, role } = parse(inviteSchema, input);
    const now = this.now();
    const targetId = await this.repo.userIdByUsername(username);
    const refusal = inviteRefusal({ inviterId: a.actorId, ownerId: a.ownerId, targetId, targetIsMember: targetId ? await this.repo.isMember(a.storeId, targetId) : false });
    if (refusal) throw new InvitationTargetError(refusal);
    if ((await this.repo.staffCount(a.storeId, now)) >= MAX_STAFF_PER_STORE) throw new StaffLimitError(MAX_STAFF_PER_STORE);
    try {
      const inv = await this.repo.createInvitation({ storeId: a.storeId, invitedUserId: targetId!, role, invitedById: a.actorId, expiresAt: invitationExpiry(now) }, now);
      await this.audit.record({ storeId: a.storeId, actorId: a.actorId, action: "staff.invited", targetType: "user", targetId: targetId!, metadata: { role } });
      return inv;
    } catch (e) {
      if (e instanceof DuplicateInvitationError) throw new InvitationTargetError("already_invited");
      throw e;
    }
  }

  async cancelInvitation(a: StoreAccessContext, invitationId: unknown): Promise<void> {
    const id = idOrNotFound(invitationId);
    if (!(await this.repo.cancelInvitation(a.storeId, id))) throw new NotFoundError();
    await this.audit.record({ storeId: a.storeId, actorId: a.actorId, action: "staff.invitation_cancelled", targetType: "invitation", targetId: id });
  }

  async changeRole(a: StoreAccessContext, userId: unknown, input: unknown): Promise<void> {
    const uid = idOrNotFound(userId);
    const { role } = parse(roleSchema, input);
    if (!(await this.repo.changeRole(a.storeId, uid, role))) throw new NotFoundError();
    await this.audit.record({ storeId: a.storeId, actorId: a.actorId, action: "staff.role_changed", targetType: "user", targetId: uid, metadata: { role } });
  }

  async removeMember(a: StoreAccessContext, userId: unknown): Promise<void> {
    const uid = idOrNotFound(userId);
    if (!(await this.repo.removeMember(a.storeId, uid))) throw new NotFoundError(); // the owner is not a member row: never removable
    await this.audit.record({ storeId: a.storeId, actorId: a.actorId, action: "staff.removed", targetType: "user", targetId: uid });
  }

  // ---- the invitee / the member (no store permission: only their own rows) ----

  myInvitations(userId: string): Promise<MyInvitationView[]> {
    return this.repo.myInvitations(userId, this.now());
  }

  async acceptInvitation(userId: string, invitationId: unknown): Promise<{ storeId: string }> {
    const got = await this.repo.acceptInvitation(idOrNotFound(invitationId), userId, this.now());
    if (!got) throw new NotFoundError(); // unknown, expired, or addressed to someone else: indistinguishable
    await this.audit.record({ storeId: got.storeId, actorId: userId, action: "staff.joined", targetType: "user", targetId: userId, metadata: { role: got.role } });
    return { storeId: got.storeId };
  }

  async declineInvitation(userId: string, invitationId: unknown): Promise<void> {
    const got = await this.repo.declineInvitation(idOrNotFound(invitationId), userId);
    if (!got) throw new NotFoundError();
    await this.audit.record({ storeId: got.storeId, actorId: userId, action: "staff.invitation_declined", targetType: "user", targetId: userId });
  }

  async leave(userId: string, storeId: unknown): Promise<void> {
    const sid = idOrNotFound(storeId);
    if (!(await this.repo.removeMember(sid, userId))) throw new NotFoundError();
    await this.audit.record({ storeId: sid, actorId: userId, action: "staff.left", targetType: "user", targetId: userId });
  }

  sharedStores(userId: string): Promise<SharedStoreView[]> {
    return this.repo.sharedStores(userId);
  }

  // ---- audit log (audit.view) ----

  auditLog(a: StoreAccessContext, query: { before?: unknown; limit?: unknown }): Promise<AuditView[]> {
    const before = typeof query.before === "string" && !Number.isNaN(Date.parse(query.before)) ? new Date(query.before) : undefined;
    const n = Number(query.limit);
    const limit = Number.isInteger(n) && n >= 1 && n <= 100 ? n : 50;
    return this.audit.list(a.storeId, { before, limit });
  }
}
