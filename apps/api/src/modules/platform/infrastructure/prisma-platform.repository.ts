import { db } from "../../../lib/db.js";
import { withDraftLockTimeout } from "../../stores/stores.api.js";
import type { PlatformRole } from "../domain/platform.js";
import type { Prisma, StoreStatus } from "@prisma/client";
import type { SuspendStoreInput } from "@store-builder/shared/modules/platform/suspension";
import type { MerchantSuspensionView, PlatformAdminView, PlatformAudit, PlatformOverview, PlatformRepository, PlatformStoreRow, StoreSuspensionView } from "../application/ports.js";

type Tx = Prisma.TransactionClient;

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
      select: { id: true, name: true, status: true, createdAt: true, suspendedAt: true, owner: { select: { username: true } }, domains: { select: { host: true }, take: 1 }, _count: { select: { products: true } } },
    });
    return rows.map((s) => ({ id: s.id, name: s.name, status: s.status, ownerUsername: s.owner.username, subdomain: s.domains[0]?.host ?? null, products: s._count.products, createdAt: s.createdAt, suspended: s.suspendedAt !== null }));
  }

  // ---- ADR 0003 (G2): platform suspension ----

  /** Locks the store row; null = no such store. The actor must still be a super admin inside the transaction. */
  private async locked(tx: Tx, storeId: string, actorId: string): Promise<{ status: StoreStatus; suspendedAt: Date | null } | "missing" | "forbidden"> {
    if (!(await tx.platformAdmin.findUnique({ where: { userId: actorId }, select: { userId: true } }))) return "forbidden";
    const rows = await tx.$queryRaw<{ status: StoreStatus; suspendedAt: Date | null }[]>`SELECT "status", "suspendedAt" FROM "Store" WHERE "id" = ${storeId} FOR UPDATE`;
    return rows[0] ?? "missing";
  }

  /**
   * Two rows: the platform's (storeId null; admins only) with the actor and the facts, and the store's own (visible to owner and managers)
   * that says only WHAT happened (review G2): no reason code, no operator identity, never a note.
   */
  private async audit(tx: Tx, storeId: string, actorId: string, action: "suspended" | "suspension_amended" | "restored", platformFacts?: Prisma.InputJsonObject) {
    await tx.auditEvent.create({ data: { storeId: null, actorId, action: `platform.store_${action}`, targetType: "store", targetId: storeId, metadata: platformFacts } });
    await tx.auditEvent.create({ data: { storeId, actorId: null, action: `store.${action}`, targetType: "store", targetId: storeId, metadata: { byPlatform: true } } });
  }

  /** The database clock for every suspension timestamp (review G2: app clocks may be skewed; the CHECK compares them). */
  private async dbNow(tx: Tx): Promise<Date> {
    return (await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS "now"`)[0]!.now;
  }

  suspend(storeId: string, input: SuspendStoreInput, actorId: string): Promise<"ok" | "missing" | "already_suspended" | "forbidden"> {
    // The Store row lock waits at most the draft lock timeout behind a merchant change or a publish (DraftBusyError, retry), never forever.
    return withDraftLockTimeout(db, async (tx) => {
      const s = await this.locked(tx, storeId, actorId);
      if (typeof s === "string") return s;
      if (s.suspendedAt) return "already_suspended";
      // An open history row without Store.suspendedAt (manual SQL gone wrong) is a conflict, not a crash on the unique index.
      if (await tx.storeSuspension.count({ where: { storeId, liftedAt: null } })) return "already_suspended";
      const at = await this.dbNow(tx);
      await tx.storeSuspension.create({ data: { storeId, reason: input.reason, publicMessage: input.publicMessage, internalNote: input.internalNote ?? "", merchantStatusAtStart: s.status, suspendedById: actorId, suspendedAt: at } });
      await tx.store.update({ where: { id: storeId }, data: { suspendedAt: at } });
      await this.audit(tx, storeId, actorId, "suspended", { reason: input.reason, merchantStatusAtStart: s.status });
      return "ok";
    });
  }

  amend(storeId: string, input: SuspendStoreInput, actorId: string): Promise<"ok" | "missing" | "not_suspended" | "forbidden"> {
    // The Store row lock waits at most the draft lock timeout behind a merchant change or a publish (DraftBusyError, retry), never forever.
    return withDraftLockTimeout(db, async (tx) => {
      const s = await this.locked(tx, storeId, actorId);
      if (typeof s === "string") return s;
      if (!s.suspendedAt) return "not_suspended";
      const open = await tx.storeSuspension.findFirst({ where: { storeId, liftedAt: null }, select: { id: true, reason: true, publicMessage: true, internalNote: true } });
      if (!open) return "not_suspended";
      // Review G2: an amendment never erases evidence. The previous values go into the PLATFORM audit row (admins only); an omitted
      // internal note keeps the old one.
      await tx.storeSuspension.update({ where: { id: open.id }, data: { reason: input.reason, publicMessage: input.publicMessage, ...(input.internalNote !== undefined ? { internalNote: input.internalNote } : {}) } });
      await this.audit(tx, storeId, actorId, "suspension_amended", { reason: input.reason, previous: { reason: open.reason, publicMessage: open.publicMessage, internalNote: open.internalNote } });
      return "ok";
    });
  }

  restore(storeId: string, note: string, actorId: string): Promise<"ok" | "missing" | "not_suspended" | "forbidden"> {
    // The Store row lock waits at most the draft lock timeout behind a merchant change or a publish (DraftBusyError, retry), never forever.
    return withDraftLockTimeout(db, async (tx) => {
      const s = await this.locked(tx, storeId, actorId);
      if (typeof s === "string") return s;
      if (!s.suspendedAt) return "not_suspended";
      // GREATEST: a lift is never before its start, whatever wrote the start (CHECK StoreSuspension_shape).
      await tx.$executeRaw`UPDATE "StoreSuspension" SET "liftedAt" = GREATEST(now(), "suspendedAt"), "liftedById" = ${actorId}, "liftNote" = ${note} WHERE "storeId" = ${storeId} AND "liftedAt" IS NULL`;
      // Only the platform condition is cleared: the merchant's status and (later) billing stay exactly as they are (ADR 0003 §0.2).
      await tx.store.update({ where: { id: storeId }, data: { suspendedAt: null } });
      await this.audit(tx, storeId, actorId, "restored");
      return "ok";
    });
  }

  async suspensions(storeId: string): Promise<StoreSuspensionView[] | null> {
    if (!(await db.store.findUnique({ where: { id: storeId }, select: { id: true } })) && (await db.storeSuspension.count({ where: { storeId } })) === 0) return null;
    return db.storeSuspension.findMany({
      where: { storeId },
      orderBy: { suspendedAt: "desc" },
      select: { id: true, reason: true, publicMessage: true, internalNote: true, merchantStatusAtStart: true, suspendedById: true, suspendedAt: true, liftedById: true, liftedAt: true, liftNote: true },
    });
  }

  /** Review G2: "suspended" comes from Store.suspendedAt, the same field every gate reads; the message from the open history row. */
  async merchantSuspension(storeId: string): Promise<MerchantSuspensionView> {
    const s = await db.store.findUnique({ where: { id: storeId }, select: { suspendedAt: true } });
    if (!s?.suspendedAt) return { suspended: false, publicMessage: null, since: null };
    const open = await db.storeSuspension.findFirst({ where: { storeId, liftedAt: null }, select: { publicMessage: true } });
    return { suspended: true, publicMessage: open?.publicMessage ?? null, since: s.suspendedAt };
  }
}
