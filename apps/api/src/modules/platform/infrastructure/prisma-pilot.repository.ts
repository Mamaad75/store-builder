import type { Prisma } from "@prisma/client";
import { db } from "../../../lib/db.js";
import type { InviteRow, PilotAudit, PilotRepository } from "../application/pilot.service.js";

const auditData = (a: PilotAudit) => ({
  storeId: null,
  actorId: a.actorId,
  action: a.action,
  targetType: a.targetType,
  targetId: a.targetId,
  ...(a.metadata ? { metadata: a.metadata as Prisma.InputJsonValue } : {}),
});

/** MVP item 2: invitations and recoveries. Every write is audited in the same transaction; codes and tokens are stored hashed only. */
export class PrismaPilotRepository implements PilotRepository {
  async invites(limit: number): Promise<InviteRow[]> {
    const rows = await db.registrationInvite.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, note: true, createdAt: true, expiresAt: true, usedAt: true, revokedAt: true, usedBy: { select: { username: true } } },
    });
    return rows.map(({ usedBy, ...r }) => ({ ...r, usedBy: usedBy?.username ?? null }));
  }

  async createInvite(i: { codeHash: string; note: string; createdById: string | null; expiresAt: Date }, a: Omit<PilotAudit, "targetId">): Promise<string> {
    return db.$transaction(async (tx) => {
      const row = await tx.registrationInvite.create({ data: i, select: { id: true } });
      await tx.auditEvent.create({ data: auditData({ ...a, targetId: row.id }) });
      return row.id;
    });
  }

  async revokeInvite(id: string, at: Date, a: PilotAudit): Promise<boolean> {
    return db.$transaction(async (tx) => {
      const n = await tx.registrationInvite.updateMany({ where: { id, usedAt: null, revokedAt: null }, data: { revokedAt: at } });
      if (n.count !== 1) return false;
      await tx.auditEvent.create({ data: auditData(a) });
      return true;
    });
  }

  async userByUsername(username: string) {
    const u = await db.user.findUnique({
      where: { username },
      select: { id: true, username: true, name: true, createdAt: true, recoveredAt: true, platformRole: { select: { userId: true } }, _count: { select: { stores: true } } },
    });
    return u ? { id: u.id, username: u.username, name: u.name, createdAt: u.createdAt, recoveredAt: u.recoveredAt, isPlatformAdmin: Boolean(u.platformRole), stores: u._count.stores } : null;
  }

  async passwordHashOf(userId: string): Promise<string | null> {
    return (await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }))?.passwordHash ?? null;
  }

  async isPlatformAdmin(userId: string): Promise<boolean> {
    return Boolean(await db.platformAdmin.findUnique({ where: { userId }, select: { userId: true } }));
  }

  async recover(userId: string, r: { tokenHash: string; reason: string; createdById: string; expiresAt: Date; passwordHash: string; now: Date }, a: PilotAudit): Promise<boolean> {
    return db.$transaction(async (tx) => {
      // Serialised per user (two admins recovering the same account at once): the user row is locked first.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      if (locked.length === 0) return false;
      await tx.accountRecovery.updateMany({ where: { userId, usedAt: null, revokedAt: null }, data: { revokedAt: r.now } });
      await tx.accountRecovery.create({ data: { userId, tokenHash: r.tokenHash, reason: r.reason, createdById: r.createdById, createdAt: r.now, expiresAt: r.expiresAt } });
      await tx.user.update({ where: { id: userId }, data: { passwordHash: r.passwordHash, authVersion: { increment: 1 }, recoveredAt: r.now } });
      await tx.auditEvent.create({ data: auditData(a) });
      return true;
    });
  }

  async audit(a: PilotAudit): Promise<void> {
    await db.auditEvent.create({ data: auditData(a) });
  }
}
