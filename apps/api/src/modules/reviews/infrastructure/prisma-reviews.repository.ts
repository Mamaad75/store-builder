import { db } from "../../../lib/db.js";
import type { ReviewStatus } from "@store-builder/shared/modules/reviews/reviews";
import { authorNameFor, canQueueAnother } from "../domain/review.js";
import type { PublicReview, ReviewRepository, StoreReview } from "../application/ports.js";

// The only file of the reviews module that reaches the database. Every query filters by the store id.

const TX = { timeout: 10_000, maxWait: 5_000 } as const;
const prismaCode = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);
const pub = (r: { id: string; authorName: string; rating: number; body: string; reply: string | null; createdAt: Date }): PublicReview => ({ id: r.id, authorName: r.authorName, rating: r.rating, body: r.body, reply: r.reply, createdAt: r.createdAt });

export class PrismaReviewsRepository implements ReviewRepository {
  async activeProduct(storeId: string, slug: string) {
    return db.product.findFirst({ where: { storeId, slug, status: "ACTIVE" }, select: { id: true, name: true } });
  }

  async approved(storeId: string, productId: string, limit: number) {
    return (await db.productReview.findMany({ where: { storeId, productId, status: "APPROVED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit })).map(pub);
  }

  async approvedTotals(storeId: string, productId: string) {
    const a = await db.productReview.aggregate({ where: { storeId, productId, status: "APPROVED" }, _count: { _all: true }, _sum: { rating: true } });
    return { count: a._count._all, sum: a._sum.rating ?? 0 };
  }

  create(storeId: string, productId: string, customerId: string, rating: number, body: string, now: Date, _max: number) {
    void _max;
    return db.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: customerId, storeId }, select: { name: true } });
      if (!customer) return "no_customer" as const;
      // The customer's row serialises their own simultaneous submissions, so the backlog limit cannot be passed by racing.
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} FOR UPDATE`;
      if (await tx.productReview.findUnique({ where: { productId_customerId: { productId, customerId } }, select: { id: true } })) return "duplicate" as const;
      const pending = await tx.productReview.count({ where: { storeId, customerId, status: "PENDING" } });
      if (!canQueueAnother(pending)) return "too_many_pending" as const;
      try {
        await tx.productReview.create({ data: { storeId, productId, customerId, authorName: authorNameFor(customer.name), rating, body, status: "PENDING", createdAt: now } });
      } catch (e) {
        if (prismaCode(e) === "P2002") return "duplicate" as const;
        throw e;
      }
      return "created" as const;
    }, TX);
  }

  async list(storeId: string, f: { status?: ReviewStatus; before?: Date; limit: number }): Promise<StoreReview[]> {
    const rows = await db.productReview.findMany({
      where: { storeId, ...(f.status ? { status: f.status } : {}), ...(f.before ? { createdAt: { lt: f.before } } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: f.limit,
      include: { product: { select: { name: true } } },
    });
    return rows.map((r) => ({ ...pub(r), productId: r.productId, productName: r.product.name, status: r.status }));
  }

  async setStatus(storeId: string, id: string, status: ReviewStatus, now: Date): Promise<boolean> {
    return (await db.productReview.updateMany({ where: { id, storeId }, data: { status, updatedAt: now } })).count === 1;
  }

  async setReply(storeId: string, id: string, reply: string | null, now: Date): Promise<boolean> {
    return (await db.productReview.updateMany({ where: { id, storeId }, data: { reply, repliedAt: reply === null ? null : now, updatedAt: now } })).count === 1;
  }
}
