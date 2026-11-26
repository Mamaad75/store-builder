import { db } from "../../../lib/db.js";
import type { DayStats } from "@store-builder/shared/modules/analytics/analytics";
import { TEHRAN_OFFSET_MINUTES } from "@store-builder/shared/modules/orders/overview";
import type { AnalyticsReader, VisitStore } from "../application/ports.js";

const VALUE_STATUSES = ["PLACED", "CONFIRMED", "SHIPPED", "DELIVERED"] as const;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Store trend charts: counters written by the storefront beacon, and per-day sums over orders and customers. Every query is per store. */
export class PrismaAnalyticsRepository implements VisitStore, AnalyticsReader {
  async record(storeId: string, day: string, hash: string): Promise<void> {
    // One statement, so concurrent views cannot lose an increment: a new visitor hash adds a visitor, a repeat only adds a view.
    await db.$executeRaw`
      WITH ins AS (
        INSERT INTO "StoreDailyVisitor" ("storeId", "day", "hash") VALUES (${storeId}, ${day}::date, ${hash})
        ON CONFLICT DO NOTHING RETURNING 1
      )
      INSERT INTO "StoreDailyStat" ("storeId", "day", "views", "visitors") VALUES (${storeId}, ${day}::date, 1, (SELECT count(*)::int FROM ins))
      ON CONFLICT ("storeId", "day") DO UPDATE SET "views" = "StoreDailyStat"."views" + 1, "visitors" = "StoreDailyStat"."visitors" + EXCLUDED."visitors"`;
  }

  async dailyRows(storeId: string, from: string, to: string, range: { fromInstant: Date; toInstant: Date }): Promise<Map<string, Partial<DayStats>>> {
    const rows = new Map<string, Partial<DayStats>>();
    const put = (day: string, v: Partial<DayStats>) => rows.set(day, { ...rows.get(day), ...v });
    const offset = TEHRAN_OFFSET_MINUTES; // Tehran is a fixed UTC+03:30: shifting an instant by it makes the date part the Tehran day
    const [stats, orders, customers] = await Promise.all([
      db.storeDailyStat.findMany({ where: { storeId, day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, select: { day: true, views: true, visitors: true } }),
      db.$queryRaw<{ day: string; orders: number; sales: bigint }[]>`
        SELECT to_char("createdAt" + (${offset} * interval '1 minute'), 'YYYY-MM-DD') AS day, count(*)::int AS orders, COALESCE(sum("total"), 0)::bigint AS sales
        FROM "Order"
        WHERE "storeId" = ${storeId} AND "createdAt" >= ${range.fromInstant} AND "createdAt" < ${range.toInstant}
          AND "status"::text = ANY(${[...VALUE_STATUSES]}::text[])
        GROUP BY 1`,
      db.$queryRaw<{ day: string; customers: number }[]>`
        SELECT to_char("createdAt" + (${offset} * interval '1 minute'), 'YYYY-MM-DD') AS day, count(*)::int AS customers
        FROM "Customer"
        WHERE "storeId" = ${storeId} AND "createdAt" >= ${range.fromInstant} AND "createdAt" < ${range.toInstant}
        GROUP BY 1`,
    ]);
    for (const s of stats) put(dayOf(s.day), { views: s.views, visitors: s.visitors });
    for (const o of orders) put(o.day, { orders: o.orders, sales: Number(o.sales) });
    for (const c of customers) put(c.day, { customers: c.customers });
    return rows;
  }

  async trackingSince(storeId: string): Promise<string | null> {
    const first = await db.storeDailyStat.findFirst({ where: { storeId }, orderBy: { day: "asc" }, select: { day: true } });
    return first ? dayOf(first.day) : null;
  }

  /** db-cleanup: visitor hashes are only needed for the current day (two days of slack for the Tehran day boundary); old counters go after 400 days. */
  async purge(now: Date): Promise<{ visitors: number; stats: number }> {
    const dayMs = 86_400_000;
    const visitors = await db.storeDailyVisitor.deleteMany({ where: { day: { lt: new Date(now.getTime() - 2 * dayMs) } } });
    const stats = await db.storeDailyStat.deleteMany({ where: { day: { lt: new Date(now.getTime() - 400 * dayMs) } } });
    return { visitors: visitors.count, stats: stats.count };
  }
}
