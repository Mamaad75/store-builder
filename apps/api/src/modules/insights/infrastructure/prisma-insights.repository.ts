import type { DayRow } from "@store-builder/shared/modules/platform/insights";
import { TEHRAN_OFFSET_MINUTES } from "@store-builder/shared/modules/orders/overview";
import { db } from "../../../lib/db.js";
import { escapeLike } from "../domain/insights.js";
import type { AccountDetail, AccountRow, ActivityRow, InsightsRepository, NowFigures, StoreDetail } from "../application/ports.js";

// Read-only. The only file of the insights module that reaches the database.

const OFFSET = `${TEHRAN_OFFSET_MINUTES} minutes`;

export class PrismaInsightsRepository implements InsightsRepository {
  async dailyRows(from: Date, to: Date): Promise<Map<string, Partial<DayRow>>> {
    const rows = new Map<string, Partial<DayRow>>();
    const put = (day: string, field: keyof DayRow, n: number) => rows.set(day, { ...rows.get(day), [field]: n });
    // The Tehran day of an instant: the UTC timestamp shifted by the fixed offset (Iran has no daylight saving), as the store trend charts do.
    const [stores, users, tickets, purchases] = await Promise.all([
      db.$queryRawUnsafe<{ day: string; n: number }[]>(`SELECT to_char("createdAt" + interval '${OFFSET}', 'YYYY-MM-DD') AS day, count(*)::int AS n FROM "Store" WHERE "createdAt" >= $1 AND "createdAt" < $2 GROUP BY 1`, from, to),
      db.$queryRawUnsafe<{ day: string; n: number }[]>(`SELECT to_char("createdAt" + interval '${OFFSET}', 'YYYY-MM-DD') AS day, count(*)::int AS n FROM "User" WHERE "createdAt" >= $1 AND "createdAt" < $2 GROUP BY 1`, from, to),
      db.$queryRawUnsafe<{ day: string; n: number }[]>(`SELECT to_char("createdAt" + interval '${OFFSET}', 'YYYY-MM-DD') AS day, count(*)::int AS n FROM "SupportTicket" WHERE "createdAt" >= $1 AND "createdAt" < $2 GROUP BY 1`, from, to),
      db.$queryRawUnsafe<{ day: string; n: number; cash: bigint }[]>(`SELECT to_char("createdAt" + interval '${OFFSET}', 'YYYY-MM-DD') AS day, count(*)::int AS n, COALESCE(sum("cashToman"), 0)::bigint AS cash FROM "SubscriptionPurchase" WHERE "createdAt" >= $1 AND "createdAt" < $2 GROUP BY 1`, from, to),
    ]);
    for (const r of stores) put(r.day, "newStores", r.n);
    for (const r of users) put(r.day, "newUsers", r.n);
    for (const r of tickets) put(r.day, "tickets", r.n);
    for (const r of purchases) {
      put(r.day, "purchases", r.n);
      put(r.day, "revenue", Number(r.cash));
    }
    return rows;
  }

  async figures(now: Date, expiringBefore: Date): Promise<NowFigures> {
    const [users, stores, publishedStores, suspendedStores, open, answered, active, expiring, wallet] = await Promise.all([
      db.user.count(),
      db.store.count(),
      db.store.count({ where: { status: "PUBLISHED" } }),
      db.store.count({ where: { suspendedAt: { not: null } } }),
      db.supportTicket.count({ where: { status: "OPEN" } }),
      db.supportTicket.count({ where: { status: "ANSWERED" } }),
      db.storeSubscription.count({ where: { endsAt: { gt: now } } }),
      db.storeSubscription.count({ where: { endsAt: { gt: now, lte: expiringBefore } } }),
      db.storeWallet.aggregate({ _sum: { balanceToman: true } }),
    ]);
    return { users, stores, publishedStores, suspendedStores, openTickets: open, answeredTickets: answered, activeSubscriptions: active, expiringSoon: expiring, walletOutstandingToman: wallet._sum.balanceToman ?? 0 };
  }

  async accounts(f: { q?: string; before?: Date; limit: number }): Promise<AccountRow[]> {
    const like = f.q ? escapeLike(f.q) : null;
    const rows = await db.user.findMany({
      where: { ...(f.before ? { createdAt: { lt: f.before } } : {}), ...(like ? { OR: [{ username: { contains: like.toLowerCase() } }, { name: { contains: like, mode: "insensitive" as const } }] } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: f.limit,
      select: { id: true, username: true, name: true, createdAt: true, platformRole: { select: { userId: true } }, _count: { select: { stores: true } } },
    });
    return rows.map((u) => ({ id: u.id, username: u.username, name: u.name, createdAt: u.createdAt, stores: u._count.stores, isPlatformAdmin: u.platformRole !== null }));
  }

  async account(id: string): Promise<AccountDetail | null> {
    const u = await db.user.findUnique({
      where: { id },
      select: { id: true, username: true, name: true, createdAt: true, recoveredAt: true, platformRole: { select: { userId: true } }, _count: { select: { stores: true, memberships: true } }, stores: { select: { id: true, name: true, status: true, suspendedAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 } },
    });
    if (!u) return null;
    return {
      id: u.id, username: u.username, name: u.name, createdAt: u.createdAt, stores: u._count.stores, isPlatformAdmin: u.platformRole !== null, recoveredAt: u.recoveredAt, memberships: u._count.memberships,
      ownedStores: u.stores.map((s) => ({ id: s.id, name: s.name, status: s.status, suspended: s.suspendedAt !== null, createdAt: s.createdAt })),
    };
  }

  async store(id: string, now: Date): Promise<StoreDetail | null> {
    const s = await db.store.findUnique({
      where: { id },
      select: {
        id: true, name: true, status: true, suspendedAt: true, createdAt: true, publishedAt: true,
        owner: { select: { id: true, username: true, name: true } },
        domains: { select: { host: true }, take: 1 },
        templateVersion: { select: { version: true, template: { select: { key: true } } } },
        subscription: { select: { planName: true, endsAt: true } },
        wallet: { select: { balanceToman: true } },
        referredBy: { select: { status: true } },
      },
    });
    if (!s) return null;
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const [productsActive, productsOther, orders, ordersLast30Days, customers, members, pendingReviews, publishedPosts, openTickets] = await Promise.all([
      db.product.count({ where: { storeId: id, status: "ACTIVE" } }),
      db.product.count({ where: { storeId: id, status: { not: "ACTIVE" } } }),
      db.order.count({ where: { storeId: id } }),
      db.order.count({ where: { storeId: id, createdAt: { gte: since } } }),
      db.customer.count({ where: { storeId: id } }),
      db.storeMember.count({ where: { storeId: id } }),
      db.productReview.count({ where: { storeId: id, status: "PENDING" } }),
      db.blogPost.count({ where: { storeId: id, status: "PUBLISHED" } }),
      db.supportTicket.count({ where: { storeId: id, status: { not: "CLOSED" } } }),
    ]);
    return {
      id: s.id, name: s.name, status: s.status, suspended: s.suspendedAt !== null, createdAt: s.createdAt, publishedAt: s.publishedAt,
      owner: s.owner, subdomain: s.domains[0]?.host ?? null, theme: { key: s.templateVersion.template.key, version: s.templateVersion.version },
      counts: { productsActive, productsOther, orders, ordersLast30Days, customers, members, pendingReviews, publishedPosts, openTickets },
      subscription: s.subscription, walletBalanceToman: s.wallet?.balanceToman ?? 0, referredByPending: s.referredBy?.status === "PENDING",
    };
  }

  async activity(f: { actions?: string[]; before?: Date; limit: number }): Promise<ActivityRow[]> {
    const rows = await db.auditEvent.findMany({
      where: { storeId: null, action: f.actions ? { in: f.actions } : { startsWith: "platform." }, ...(f.before ? { createdAt: { lt: f.before } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: f.limit,
    });
    const ids = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
    const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.username]));
    return rows.map((r) => ({ id: r.id, action: r.action, actor: r.actorId ? (names.get(r.actorId) ?? null) : null, targetType: r.targetType, targetId: r.targetId, metadata: r.metadata, createdAt: r.createdAt }));
  }
}
