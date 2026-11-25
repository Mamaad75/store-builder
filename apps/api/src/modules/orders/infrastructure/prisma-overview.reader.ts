import type { OrderStatus, PaymentMethod } from "@store-builder/shared/modules/orders/orders";
import { db } from "../../../lib/db.js";
import type { OverviewReader } from "../application/overview.service.js";
import { RECEIPT_REVIEW_WHERE } from "./receipt-review.js";

/** How many low-stock candidates are read to pick the lowest ones (the count itself is exact). */
const LOW_STOCK_SCAN = 500;

/** M2: read-only aggregates for the store overview. Every query is filtered by the caller's storeId. */
export class PrismaOverviewReader implements OverviewReader {
  async buckets(storeId: string, since: Date | null) {
    const rows = await db.order.groupBy({
      by: ["status", "paymentMethod"],
      where: { storeId, ...(since ? { createdAt: { gte: since } } : {}) },
      _count: { _all: true },
      _sum: { total: true },
    });
    return rows.map((r) => ({ status: r.status as OrderStatus, paymentMethod: r.paymentMethod as PaymentMethod, count: r._count._all, total: Number(r._sum.total ?? 0n) }));
  }

  async cardInReview(storeId: string) {
    const r = await db.order.aggregate({
      where: { storeId, ...RECEIPT_REVIEW_WHERE },
      _count: { _all: true },
      _sum: { total: true },
    });
    return { count: r._count._all, total: Number(r._sum.total ?? 0n) };
  }

  async lowStock(storeId: string, threshold: number, limit: number) {
    const where = { storeId, status: "ACTIVE" as const, OR: [{ stockQuantity: { lte: threshold } }, { variants: { some: { stockQuantity: { lte: threshold } } } }] };
    const [total, rows] = await Promise.all([
      db.product.count({ where }),
      db.product.findMany({
        where,
        select: { id: true, name: true, stockQuantity: true, variants: { select: { stockQuantity: true }, orderBy: { stockQuantity: "asc" }, take: 1 } },
        orderBy: [{ stockQuantity: "asc" }, { id: "asc" }],
        take: LOW_STOCK_SCAN,
      }),
    ]);
    const items = rows
      .map((p) => ({ productId: p.id, name: p.name, stock: p.variants[0]?.stockQuantity ?? p.stockQuantity }))
      .sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name, "fa"))
      .slice(0, limit);
    return { total, items };
  }
}
