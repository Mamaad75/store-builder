import { db } from "../../../lib/db.js";
import type { PlatformRole } from "../domain/platform.js";
import type { PlatformAdminView, PlatformAudit, PlatformOverview, PlatformRepository, PlatformStoreRow } from "../application/ports.js";

// The only file of the platform module that reaches the database. Grants and revocations take one advisory lock, so "never the last super
// admin" holds under concurrent revocations; audit entries (storeId null) are written in the same transaction.
const lock = (tx: Pick<typeof db, "$executeRaw">) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform-admins', 0))`;

export class PrismaPlatformRepository implements PlatformRepository {
  async roleOf(userId: string): Promise<PlatformRole | null> {
    return (await db.platformAdmin.findUnique({ where: { userId }, select: { role: true } }))?.role ?? null;
  }

  async admins(): Promise<PlatformAdminView[]> {
    const rows = await db.platformAdmin.findMany({ orderBy: { grantedAt: "asc" }, select: { userId: true, role: true, grantedAt: true, user: { select: { username: true, name: true } } } });
    return rows.map((r) => ({ userId: r.userId, username: r.user.username, name: r.user.name, role: r.role, grantedAt: r.grantedAt }));
  }

  countAdmins(): Promise<number> {
    return db.platformAdmin.count();
  }

  async userIdByUsername(username: string): Promise<string | null> {
    return (await db.user.findUnique({ where: { username }, select: { id: true } }))?.id ?? null;
  }

  grant(userId: string, role: PlatformRole, a: PlatformAudit): Promise<"ok" | "exists" | "forbidden"> {
    return db.$transaction(async (tx) => {
      await lock(tx);
      if (a.actorId && !(await tx.platformAdmin.findUnique({ where: { userId: a.actorId }, select: { userId: true } }))) return "forbidden";
      if (await tx.platformAdmin.findUnique({ where: { userId }, select: { userId: true } })) return "exists";
      await tx.platformAdmin.create({ data: { userId, role, grantedById: a.actorId } });
      await tx.auditEvent.create({ data: { storeId: null, actorId: a.actorId, action: a.action, targetType: a.targetType, targetId: a.targetId } });
      return "ok";
    });
  }

  revoke(userId: string, a: PlatformAudit): Promise<"ok" | "missing" | "last_admin" | "forbidden"> {
    return db.$transaction(async (tx) => {
      await lock(tx);
      if (a.actorId && !(await tx.platformAdmin.findUnique({ where: { userId: a.actorId }, select: { userId: true } }))) return "forbidden";
      if (!(await tx.platformAdmin.findUnique({ where: { userId }, select: { userId: true } }))) return "missing";
      if ((await tx.platformAdmin.count()) <= 1) return "last_admin";
      await tx.platformAdmin.delete({ where: { userId } });
      await tx.auditEvent.create({ data: { storeId: null, actorId: a.actorId, action: a.action, targetType: a.targetType, targetId: a.targetId } });
      return "ok";
    });
  }

  async overview(): Promise<PlatformOverview> {
    const [users, stores, publishedStores, products, customers] = await Promise.all([
      db.user.count(),
      db.store.count(),
      db.store.count({ where: { status: "PUBLISHED" } }),
      db.product.count(),
      db.customer.count(),
    ]);
    return { users, stores, publishedStores, products, customers };
  }

  async stores(o: { before?: Date; limit: number }): Promise<PlatformStoreRow[]> {
    const rows = await db.store.findMany({
      where: o.before ? { createdAt: { lt: o.before } } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: o.limit,
      select: { id: true, name: true, status: true, createdAt: true, owner: { select: { username: true } }, domains: { select: { host: true }, take: 1 }, _count: { select: { products: true } } },
    });
    return rows.map((s) => ({ id: s.id, name: s.name, status: s.status, ownerUsername: s.owner.username, subdomain: s.domains[0]?.host ?? null, products: s._count.products, createdAt: s.createdAt }));
  }
}
