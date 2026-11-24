import type { StaffRole } from "@store-builder/shared/modules/access/permissions";
import { normalizeUsername } from "../../../auth/schemas.js";
import { Prisma } from "../../../database/prisma-runtime.js";
import { db } from "../../../lib/db.js";
import { AUDIT_RETENTION_DAYS } from "@store-builder/shared/modules/access/permissions";
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
} from "../application/ports.js";
import type { StoreAccessFacts } from "../domain/access.js";

// The only file of the access module that reaches the database. Staff rows are always filtered by storeId AND userId in SQL.

export class PrismaAccessRepository implements AccessRepository {
  async facts(storeId: string, userId: string): Promise<StoreAccessFacts | null> {
    const s = await db.store.findUnique({ where: { id: storeId }, select: { ownerId: true, suspendedAt: true, members: { where: { userId }, select: { role: true } } } });
    return s ? { ownerId: s.ownerId, memberRole: (s.members[0]?.role as StaffRole | undefined) ?? null, suspended: s.suspendedAt !== null } : null;
  }

  async userIdByUsername(username: string): Promise<string | null> {
    return (await db.user.findUnique({ where: { username: normalizeUsername(username) }, select: { id: true } }))?.id ?? null;
  }

  async isMember(storeId: string, userId: string): Promise<boolean> {
    return (await db.storeMember.count({ where: { storeId, userId } })) === 1;
  }

  async members(storeId: string): Promise<MemberView[]> {
    const s = await db.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { owner: { select: { id: true, username: true, name: true } }, members: { select: { role: true, createdAt: true, user: { select: { id: true, username: true, name: true } } }, orderBy: { createdAt: "asc" } } },
    });
    return [
      { userId: s.owner.id, username: s.owner.username, name: s.owner.name, role: "OWNER", since: null },
      ...s.members.map((m) => ({ userId: m.user.id, username: m.user.username, name: m.user.name, role: m.role as StaffRole, since: m.createdAt })),
    ];
  }

  async invitations(storeId: string, now: Date): Promise<InvitationView[]> {
    const rows = await db.storeInvitation.findMany({ where: { storeId, expiresAt: { gt: now } }, orderBy: { createdAt: "asc" }, select: { id: true, role: true, createdAt: true, expiresAt: true, invitedUser: { select: { username: true, name: true } } } });
    return rows.map((r) => ({ id: r.id, username: r.invitedUser.username, name: r.invitedUser.name, role: r.role as StaffRole, createdAt: r.createdAt, expiresAt: r.expiresAt }));
  }

  async staffCount(storeId: string, now: Date): Promise<number> {
    const [m, i] = await Promise.all([db.storeMember.count({ where: { storeId } }), db.storeInvitation.count({ where: { storeId, expiresAt: { gt: now } } })]);
    return m + i;
  }

  async createInvitation(i: { storeId: string; invitedUserId: string; role: StaffRole; invitedById: string; expiresAt: Date }, now: Date): Promise<{ id: string }> {
    try {
      return await db.$transaction(async (tx) => {
        // an EXPIRED invitation for the same person is replaced; a pending one stays (unique key) and is reported as a duplicate
        await tx.storeInvitation.deleteMany({ where: { storeId: i.storeId, invitedUserId: i.invitedUserId, expiresAt: { lte: now } } });
        return tx.storeInvitation.create({ data: { ...i, createdAt: now }, select: { id: true } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new DuplicateInvitationError();
      throw e;
    }
  }

  async myInvitations(userId: string, now: Date): Promise<MyInvitationView[]> {
    const rows = await db.storeInvitation.findMany({ where: { invitedUserId: userId, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" }, select: { id: true, storeId: true, role: true, expiresAt: true, invitedById: true, store: { select: { name: true } } } });
    const inviters = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.invitedById))] } }, select: { id: true, username: true } })).map((u) => [u.id, u.username]));
    return rows.map((r) => ({ id: r.id, storeId: r.storeId, storeName: r.store.name, role: r.role as StaffRole, invitedBy: inviters.get(r.invitedById) ?? "", expiresAt: r.expiresAt }));
  }

  async acceptInvitation(id: string, userId: string, now: Date): Promise<{ storeId: string; role: StaffRole } | null> {
    return db.$transaction(async (tx) => {
      // consume first: two concurrent accepts of the same invitation cannot both succeed
      const rows = await tx.$queryRaw<{ storeId: string; role: StaffRole }[]>`
        DELETE FROM "StoreInvitation" WHERE "id" = ${id} AND "invitedUserId" = ${userId} AND "expiresAt" > ${now}
        RETURNING "storeId", "role"::text AS "role"`;
      const inv = rows[0];
      if (!inv) return null;
      await tx.$executeRaw`
        INSERT INTO "StoreMember" ("storeId", "userId", "role") VALUES (${inv.storeId}, ${userId}, ${inv.role}::"StoreRole")
        ON CONFLICT ("storeId", "userId") DO NOTHING`;
      return inv;
    });
  }

  async declineInvitation(id: string, userId: string): Promise<{ storeId: string } | null> {
    const rows = await db.$queryRaw<{ storeId: string }[]>`DELETE FROM "StoreInvitation" WHERE "id" = ${id} AND "invitedUserId" = ${userId} RETURNING "storeId"`;
    return rows[0] ?? null;
  }

  async cancelInvitation(storeId: string, id: string): Promise<boolean> {
    return (await db.storeInvitation.deleteMany({ where: { id, storeId } })).count === 1;
  }

  async removeMember(storeId: string, userId: string): Promise<boolean> {
    return (await db.storeMember.deleteMany({ where: { storeId, userId } })).count === 1;
  }

  async changeRole(storeId: string, userId: string, role: StaffRole): Promise<boolean> {
    return (await db.storeMember.updateMany({ where: { storeId, userId }, data: { role } })).count === 1;
  }

  async sharedStores(userId: string): Promise<SharedStoreView[]> {
    const rows = await db.storeMember.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { role: true, store: { select: { id: true, name: true } } } });
    return rows.map((r) => ({ storeId: r.store.id, name: r.store.name, role: r.role as StaffRole }));
  }
}

export class PrismaAuditRepository implements AuditRepository {
  async record(e: AuditInput): Promise<void> {
    await db.auditEvent.create({
      data: { storeId: e.storeId, actorId: e.actorId, action: e.action, targetType: e.targetType ?? null, targetId: e.targetId?.slice(0, 64) ?? null, metadata: e.metadata ?? Prisma.DbNull },
    });
  }

  async list(storeId: string, o: { before?: Date; limit: number }): Promise<AuditView[]> {
    const rows = await db.auditEvent.findMany({ where: { storeId, ...(o.before ? { createdAt: { lt: o.before } } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: o.limit });
    const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, username: true } })).map((u) => [u.id, u.username]));
    return rows.map((r) => ({ id: r.id, action: r.action, actorId: r.actorId, actorUsername: r.actorId ? (names.get(r.actorId) ?? null) : null, targetType: r.targetType, targetId: r.targetId, metadata: r.metadata, createdAt: r.createdAt }));
  }

  /** Retention (D23-3): run by db-cleanup. */
  async purgeOlderThan(days = AUDIT_RETENTION_DAYS, batch = 1_000, maxBatches = 50): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxBatches; i++) {
      const n = await db.$executeRaw`
        DELETE FROM "AuditEvent" WHERE "id" IN (
          SELECT "id" FROM "AuditEvent" WHERE "createdAt" < now() - (${days}::integer * interval '1 day') LIMIT ${batch}::integer FOR UPDATE SKIP LOCKED)`;
      total += n;
      if (n < batch) break;
    }
    return total;
  }
}
