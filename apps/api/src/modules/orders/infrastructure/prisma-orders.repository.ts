import type { Prisma } from "@prisma/client";
import { restocksOn, type Gateway, type OrderStatus, type PaymentMethod } from "@store-builder/shared/modules/orders/orders";
import type { ShippingKind } from "@store-builder/shared/modules/checkout/checkout";
import { PaymentNotAllowedError } from "@store-builder/shared/modules/orders/errors";
import { db } from "../../../lib/db.js";
import { recordEvent } from "../../../platform/outbox/outbox.js";
import { clearCartInTx } from "../../checkout/checkout.api.js";
import { customerIdForPhoneInTx } from "../../customers/customers.api.js";
import { consumeReservationInTx, restockReservationInTx } from "../../inventory/inventory.api.js";
import { redeemDiscountInTx, releaseDiscountInTx } from "../../discounts/discounts.api.js";
import type { DiscountCart } from "@store-builder/shared/modules/discounts/discounts";
import type { OrderListPage, OrderStore } from "../application/ports.js";
import { RECEIPT_REVIEW_WHERE } from "./receipt-review.js";
import type { NewOrder, OrderView } from "../domain/orders.js";

// The only file of the orders module that reaches the database. Every query is bound to the store id (and, for shoppers, to the customer
// or the access-token hash). Money is BigInt in the database and a JS number in views: every amount is bounded far below 2^53.

const TX = { timeout: 10_000, maxWait: 5_000 } as const;
const prismaCode = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);

const orderSelect = {
  id: true, number: true, status: true, createdAt: true, customerId: true,
  recipientName: true, phone: true, province: true, city: true, addressLine: true, postalCode: true,
  shippingName: true, shippingKind: true, shippingCost: true, paymentMethod: true, paymentGateway: true, paymentDeadline: true, codFee: true, discountCode: true, discountAmount: true, subtotal: true, total: true, itemCount: true, note: true,
  items: { select: { productId: true, variantId: true, name: true, variantLabel: true, unitPrice: true, quantity: true, lineTotal: true, weightGrams: true }, orderBy: { position: "asc" as const } },
  payments: { where: { status: "PAID" as const }, select: { refId: true, cardPan: true, verifiedAt: true }, take: 1 },
  events: { select: { fromStatus: true, toStatus: true, actor: true, note: true, createdAt: true }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.OrderSelect;
type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

function toView(r: OrderRow): OrderView {
  return {
    id: r.id,
    number: r.number,
    status: r.status as OrderStatus,
    createdAt: r.createdAt.toISOString(),
    customerId: r.customerId,
    address: { recipientName: r.recipientName, phone: r.phone, province: r.province, city: r.city, line: r.addressLine, postalCode: r.postalCode },
    shipping: { name: r.shippingName, kind: r.shippingKind as ShippingKind, cost: Number(r.shippingCost) },
    paymentMethod: r.paymentMethod as PaymentMethod,
    paymentGateway: (r.paymentGateway as Gateway | null) ?? null,
    discountCode: r.discountCode,
    discountAmount: Number(r.discountAmount),
    paymentDeadline: r.paymentDeadline?.toISOString() ?? null,
    payment: r.payments[0] ? { refId: r.payments[0].refId!, cardPan: r.payments[0].cardPan, paidAt: r.payments[0].verifiedAt!.toISOString() } : null,
    subtotal: Number(r.subtotal),
    codFee: Number(r.codFee),
    total: Number(r.total),
    itemCount: r.itemCount,
    note: r.note,
    items: r.items.map((i) => ({ ...i, lineTotal: Number(i.lineTotal) })),
    history: r.events.map((e) => ({ from: e.fromStatus as OrderStatus | null, to: e.toStatus as OrderStatus, actor: e.actor, note: e.note, at: e.createdAt.toISOString() })),
  };
}

class HoldLost extends Error {}

export class PrismaOrderStore implements OrderStore {
  private async one(where: Prisma.OrderWhereInput): Promise<OrderView | null> {
    const r = await db.order.findFirst({ where, select: orderSelect });
    return r ? toView(r) : null;
  }

  findByRequestKey(storeId: string, requestKey: string) {
    return this.one({ storeId, requestKey });
  }

  getById(storeId: string, id: string) {
    return this.one({ storeId, id });
  }

  getByTokenHash(storeId: string, accessTokenHash: string) {
    return this.one({ storeId, accessTokenHash });
  }

  getForCustomer(storeId: string, customerId: string, id: string, includePhoneLinked: boolean) {
    return this.one({ storeId, customerId, id, ...(includePhoneLinked ? {} : { linkedByPhone: false }) });
  }

  async listForCustomer(storeId: string, customerId: string, limit: number, includePhoneLinked: boolean): Promise<OrderView[]> {
    const rows = await db.order.findMany({ where: { storeId, customerId, ...(includePhoneLinked ? {} : { linkedByPhone: false }) }, select: orderSelect, orderBy: { number: "desc" }, take: limit });
    return rows.map(toView);
  }

  async customerStats(storeId: string, customerIds: string[]) {
    const rows = await db.order.groupBy({
      by: ["customerId"],
      where: { storeId, customerId: { in: customerIds } },
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const spent = await db.order.groupBy({ by: ["customerId"], where: { storeId, customerId: { in: customerIds }, status: { notIn: ["CANCELLED", "EXPIRED", "AWAITING_PAYMENT"] } }, _sum: { total: true } });
    const spentBy = new Map(spent.map((r) => [r.customerId, Number(r._sum.total ?? 0n)]));
    return rows.map((r) => ({ customerId: r.customerId!, orders: r._count._all, spent: spentBy.get(r.customerId) ?? 0, lastOrderAt: r._max.createdAt?.toISOString() ?? null }));
  }

  async list(storeId: string, q: { status?: OrderStatus; customerId?: string; review?: "receipt"; before?: string; limit: number }): Promise<OrderListPage> {
    const where: Prisma.OrderWhereInput = {
      storeId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      // M2: combined with AND, so a conflicting ?status= gives an empty page rather than widening the filter.
      ...(q.review === "receipt" ? { AND: [RECEIPT_REVIEW_WHERE] } : {}),
    };
    if (q.before) {
      // Keyset on the gap-free per-store number (strictly increasing with time; createdAt can tie within a millisecond). The cursor
      // must be an order of THIS store; a foreign or unknown cursor is an empty page.
      const c = await db.order.findFirst({ where: { storeId, id: q.before }, select: { number: true } });
      if (!c) return { items: [], nextCursor: null };
      where.number = { lt: c.number };
    }
    const rows = await db.order.findMany({ where, select: orderSelect, orderBy: { number: "desc" }, take: q.limit + 1 });
    const page = rows.slice(0, q.limit).map(toView);
    return { items: page, nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null };
  }

  async create(o: NewOrder, holdLines: number, cartId: string | null, now: Date, discountCart?: DiscountCart): Promise<OrderView | "hold_lost" | "duplicate"> {
    try {
      await db.$transaction(async (tx) => {
        const scope = { tx };
        // 1. the stock hold becomes the order's stock (or nothing happens)
        if (!(await consumeReservationInTx(scope, o.storeId, o.id, now, holdLines))) throw new HoldLost();
        // Phase 3.3b: a guest order belongs to the store's customer with the same phone (created unverified when missing).
        const linkedByPhone = o.customerId === null;
        const customerId = o.customerId ?? (await customerIdForPhoneInTx(scope, o.storeId, o.address.phone, o.address.recipientName));
        // 2. the next number: the counter row is locked until commit, so numbers are unique and a rollback leaves no gap
        const [counter] = await tx.$queryRaw<{ n: number }[]>`
          INSERT INTO "StoreCounter" ("storeId", "lastOrderNumber") VALUES (${o.storeId}, 1)
          ON CONFLICT ("storeId") DO UPDATE SET "lastOrderNumber" = "StoreCounter"."lastOrderNumber" + 1
          RETURNING "lastOrderNumber" AS n`;
        // 3. the snapshot. Phase 3.5: an online order waits for its payment (AWAITING_PAYMENT, with a deadline); "order.placed" is
        // recorded only once the payment is verified (PaymentStore.settlePaid), so nothing is sent for an order nobody paid.
        const first = o.paymentMethod === "COD" ? "PLACED" : "AWAITING_PAYMENT"; // prepaid (online, card-to-card) orders wait for their payment
        await tx.order.create({
          data: {
            id: o.id, storeId: o.storeId, number: counter!.n, status: first, customerId, linkedByPhone, requestKey: o.requestKey, accessTokenHash: o.accessTokenHash,
            recipientName: o.address.recipientName, phone: o.address.phone, province: o.address.province, city: o.address.city, addressLine: o.address.line, postalCode: o.address.postalCode,
            shippingMethodId: o.shipping.methodId, shippingName: o.shipping.name, shippingKind: o.shipping.kind, shippingCost: BigInt(o.shipping.cost),
            paymentMethod: o.paymentMethod, paymentGateway: o.paymentGateway, paymentDeadline: o.paymentDeadline,
            discountCode: o.discount?.code ?? null, discountAmount: BigInt(o.discount?.amount ?? 0), codFee: BigInt(o.codFee), subtotal: BigInt(o.subtotal), total: BigInt(o.total), itemCount: o.itemCount, note: o.note,
          },
        });
        await tx.orderItem.createMany({ data: o.items.map((i) => ({ ...i, storeId: o.storeId, orderId: o.id, lineTotal: BigInt(i.lineTotal) })) });
        // Phase 5.1: the code's binding use, under its row lock (limits checked again on this order's own cart; any change refuses).
        if (o.discount) {
          await redeemDiscountInTx(scope, {
            storeId: o.storeId, discountId: o.discount.id, orderId: o.id, phone: o.address.phone, customerId,
            cart: discountCart ?? { lines: [], subtotal: o.subtotal, shippingCost: o.shipping.cost }, expectedAmount: o.discount.amount, now,
          });
        }
        await tx.orderEvent.create({ data: { storeId: o.storeId, orderId: o.id, fromStatus: null, toStatus: first, actor: "CUSTOMER", actorId: linkedByPhone ? null : customerId } });
        // 4. consumers (order SMS, 3.6) re-read the order; the event carries ids only, never personal data
        if (first === "PLACED") await recordEvent(scope, { type: "order.placed", storeId: o.storeId, payload: { orderId: o.id, number: counter!.n } });
        // 5. the cart is emptied with the order
        if (cartId) await clearCartInTx(scope, o.storeId, cartId);
      }, TX);
    } catch (e) {
      if (e instanceof HoldLost) return "hold_lost";
      // the same request key committed first (only that unique index means "the same checkout")
      if (prismaCode(e) === "P2002" && JSON.stringify((e as { meta?: unknown }).meta ?? "").includes("requestKey")) return "duplicate";
      throw e;
    }
    return (await this.getById(o.storeId, o.id))!;
  }

  async transition(
    storeId: string,
    id: string,
    to: OrderStatus,
    check: (current: OrderStatus, paymentMethod: PaymentMethod) => void,
    by: { actor: "CUSTOMER" | "MERCHANT" | "SYSTEM"; actorId: string | null; note: string },
  ): Promise<OrderView | null> {
    const done = await db.$transaction(async (tx) => {
      // Lock order: the order row first, then (cancellation) product rows and reservation rows, as the stock ledger does.
      const [row] = await tx.$queryRaw<{ status: OrderStatus; method: PaymentMethod }[]>`
        SELECT status::text AS status, "paymentMethod"::text AS method FROM "Order" WHERE id = ${id} AND "storeId" = ${storeId} FOR UPDATE`;
      if (!row) return false;
      check(row.status, row.method);
      // Phase 3.5: an unpaid order whose payment may hold money right now (being verified, or a verify answer was lost) cannot be cancelled.
      if (row.status === "AWAITING_PAYMENT") {
        const busy = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Payment" WHERE "storeId" = ${storeId} AND "orderId" = ${id}
            AND (status IN ('VERIFYING', 'PAID') OR (status = 'CREATED' AND "verifySentAt" IS NOT NULL)) FOR UPDATE`;
        if (busy.length) throw new PaymentNotAllowedError("busy");
        // D35b-1: a card-to-card receipt under review: the shopper cannot cancel; the merchant's cancel rejects it in the same transaction.
        if (await tx.transferReceipt.count({ where: { storeId, orderId: id, status: "SUBMITTED" } })) {
          if (by.actor !== "MERCHANT") throw new PaymentNotAllowedError("busy");
          await tx.transferReceipt.updateMany({
            where: { storeId, orderId: id, status: "SUBMITTED" },
            data: { status: "REJECTED", reviewNote: by.note.length >= 3 ? by.note.slice(0, 300) : "سفارش توسط فروشگاه لغو شد", reviewedById: by.actorId, reviewedAt: new Date() },
          });
        }
      }
      await tx.order.updateMany({ where: { id, storeId, status: row.status }, data: { status: to } });
      await tx.orderEvent.create({ data: { storeId, orderId: id, fromStatus: row.status, toStatus: to, actor: by.actor, actorId: by.actorId, note: by.note } });
      if (restocksOn(to)) {
        await restockReservationInTx({ tx }, storeId, id);
        await releaseDiscountInTx({ tx }, storeId, id); // phase 5.1: the code's use comes back
      }
      await recordEvent({ tx }, { type: "order.status_changed", storeId, payload: { orderId: id, from: row.status, to, actor: by.actor } });
      return true;
    }, TX);
    return done ? this.getById(storeId, id) : null;
  }
}
