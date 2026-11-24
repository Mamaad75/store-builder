import type { Prisma } from "@prisma/client";
import { evaluateDiscount, type DiscountCart, type DiscountInput, type DiscountRule, type DiscountUsage } from "@store-builder/shared/modules/discounts/discounts";
import { DiscountInvalidError } from "@store-builder/shared/modules/discounts/errors";
import { db } from "../../../lib/db.js";
import type { DiscountStore } from "../application/ports.js";
import type { DiscountView } from "../domain/discounts.js";

// Phase 5.1 (D51-1): the only file of the discounts module that reaches the database.

const TX = { timeout: 10_000, maxWait: 5_000 } as const;
const prismaCode = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);

const ruleSelect = {
  id: true, code: true, title: true, type: true, value: true, maxDiscount: true, minOrder: true, startsAt: true, endsAt: true, usageLimit: true,
  perCustomerLimit: true, firstOrderOnly: true, scope: true, scopeIds: true, active: true, createdAt: true,
} satisfies Prisma.DiscountSelect;
type Row = Prisma.DiscountGetPayload<{ select: typeof ruleSelect }>;

const toRule = (r: Row): DiscountRule & { title: string; createdAt: string } => ({
  id: r.id, code: r.code, title: r.title, type: r.type, value: Number(r.value), maxDiscount: r.maxDiscount === null ? null : Number(r.maxDiscount),
  minOrder: r.minOrder === null ? null : Number(r.minOrder), startsAt: r.startsAt?.toISOString() ?? null, endsAt: r.endsAt?.toISOString() ?? null,
  usageLimit: r.usageLimit, perCustomerLimit: r.perCustomerLimit, firstOrderOnly: r.firstOrderOnly, scope: r.scope, scopeIds: r.scopeIds, active: r.active,
  createdAt: r.createdAt.toISOString(),
});

const data = (d: DiscountInput) => ({
  code: d.code, title: d.title, type: d.type, value: BigInt(d.value), maxDiscount: d.maxDiscount === null ? null : BigInt(d.maxDiscount),
  minOrder: d.minOrder === null ? null : BigInt(d.minOrder), startsAt: d.startsAt ? new Date(d.startsAt) : null, endsAt: d.endsAt ? new Date(d.endsAt) : null,
  usageLimit: d.usageLimit, perCustomerLimit: d.perCustomerLimit, firstOrderOnly: d.firstOrderOnly, scope: d.scope, scopeIds: d.scopeIds, active: d.active,
});

type Client = Prisma.TransactionClient | typeof db;

/** Uses that count: redemptions not released (their order is not cancelled or expired). */
async function usageOf(c: Client, storeId: string, discountId: string, who: { phone: string | null; customerId: string | null }, exceptOrderId?: string): Promise<DiscountUsage> {
  const total = await c.discountRedemption.count({ where: { storeId, discountId, released: false } });
  const mine = who.phone || who.customerId
    ? await c.discountRedemption.count({
        where: { storeId, discountId, released: false, OR: [...(who.phone ? [{ phone: who.phone }] : []), ...(who.customerId ? [{ customerId: who.customerId }] : [])] },
      })
    : null;
  // "First order": no other order of this phone in this store that still stands (cancelled and expired ones do not count).
  const prior = who.phone
    ? (await c.order.count({ where: { storeId, phone: who.phone, status: { notIn: ["CANCELLED", "EXPIRED"] }, ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}) } })) > 0
    : null;
  return { total, byCustomer: mine, hasPriorOrders: prior };
}

export class PrismaDiscountStore implements DiscountStore {
  private async view(storeId: string, r: Row): Promise<DiscountView> {
    return { ...toRule(r), used: await db.discountRedemption.count({ where: { storeId, discountId: r.id, released: false } }) };
  }

  async list(storeId: string) {
    const rows = await db.discount.findMany({ where: { storeId }, select: ruleSelect, orderBy: { createdAt: "desc" } });
    const used = await db.discountRedemption.groupBy({ by: ["discountId"], where: { storeId, released: false }, _count: { _all: true } });
    const by = new Map(used.map((u) => [u.discountId, u._count._all]));
    return rows.map((r) => ({ ...toRule(r), used: by.get(r.id) ?? 0 }));
  }

  async get(storeId: string, id: string) {
    const r = await db.discount.findFirst({ where: { storeId, id }, select: ruleSelect });
    return r ? this.view(storeId, r) : null;
  }

  async findByCode(storeId: string, code: string) {
    const r = await db.discount.findUnique({ where: { storeId_code: { storeId, code } }, select: ruleSelect });
    return r ? toRule(r) : null;
  }

  async create(storeId: string, d: DiscountInput, max: number) {
    try {
      const r = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"discounts:" + storeId}))`;
        if ((await tx.discount.count({ where: { storeId } })) >= max) return "limit" as const;
        return tx.discount.create({ data: { storeId, ...data(d) }, select: ruleSelect });
      }, TX);
      return r === "limit" ? r : this.view(storeId, r);
    } catch (e) {
      if (prismaCode(e) === "P2002") return "taken" as const;
      throw e;
    }
  }

  async update(storeId: string, id: string, d: DiscountInput) {
    try {
      const n = await db.discount.updateMany({ where: { storeId, id }, data: data(d) });
      return n.count ? this.get(storeId, id) : null;
    } catch (e) {
      if (prismaCode(e) === "P2002") return "taken" as const;
      throw e;
    }
  }

  async remove(storeId: string, id: string) {
    return (await db.discount.deleteMany({ where: { storeId, id } })).count > 0;
  }

  usage(storeId: string, discountId: string, who: { phone: string | null; customerId: string | null }) {
    return usageOf(db, storeId, discountId, who);
  }
}

/**
 * Phase 5.1: the binding use of a code, INSIDE the order's transaction (the order row exists): the discount row is locked, the rule and
 * every limit are checked again on the order's own cart, and a redemption is written. The amount must be the one the order was priced
 * with; anything else (the code was changed, exhausted or switched off meanwhile) throws DiscountInvalidError and the order is not placed.
 */
export async function redeemDiscountInTx(
  scope: { tx: Prisma.TransactionClient },
  r: { storeId: string; discountId: string; orderId: string; phone: string; customerId: string | null; cart: DiscountCart; expectedAmount: number; now: Date },
): Promise<void> {
  const { tx } = scope;
  const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Discount" WHERE id = ${r.discountId} AND "storeId" = ${r.storeId} FOR UPDATE`;
  if (!locked) throw new DiscountInvalidError("not_found");
  const row = await tx.discount.findUniqueOrThrow({ where: { id: r.discountId }, select: ruleSelect });
  const usage = await usageOf(tx, r.storeId, r.discountId, { phone: r.phone, customerId: r.customerId }, r.orderId);
  const result = evaluateDiscount(toRule(row), r.cart, usage, r.now);
  if (!result.ok) throw new DiscountInvalidError(result.reason, result.minOrder);
  if (result.amount !== r.expectedAmount) throw new DiscountInvalidError("changed");
  await tx.discountRedemption.create({
    data: { storeId: r.storeId, discountId: r.discountId, orderId: r.orderId, phone: r.phone, customerId: r.customerId, amount: BigInt(result.amount) },
  });
}

/** Phase 5.1: a cancelled or expired order gives its use of the code back (in the transaction that cancels or expires it). */
export async function releaseDiscountInTx(scope: { tx: Prisma.TransactionClient }, storeId: string, orderId: string): Promise<void> {
  await scope.tx.discountRedemption.updateMany({ where: { storeId, orderId, released: false }, data: { released: true } });
}
