import type { Prisma } from "@prisma/client";
import { restocksOn, type OrderStatus, type PaymentMethod } from "@store-builder/shared/modules/orders/orders";
import type { ShippingKind } from "@store-builder/shared/modules/checkout/checkout";
import { db } from "../../../lib/db.js";
import { recordEvent } from "../../../platform/outbox/outbox.js";
import { clearCartInTx } from "../../checkout/checkout.api.js";
import { consumeReservationInTx, restockReservationInTx } from "../../inventory/inventory.api.js";
import type { OrderListPage, OrderStore } from "../application/ports.js";
import type { NewOrder, OrderView } from "../domain/orders.js";

// The only file of the orders module that reaches the database. Every query is bound to the store id (and, for shoppers, to the customer
// or the access-token hash). Money is BigInt in the database and a JS number in views: every amount is bounded far below 2^53.

const TX = { timeout: 10_000, maxWait: 5_000 } as const;
const prismaCode = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);

const orderSelect = {
  id: true, number: true, status: true, createdAt: true, customerId: true,
  recipientName: true, phone: true, province: true, city: true, addressLine: true, postalCode: true,
  shippingName: true, shippingKind: true, shippingCost: true, paymentMethod: true, codFee: true, subtotal: true, total: true, itemCount: true, note: true,
  items: { select: { productId: true, variantId: true, name: true, variantLabel: true, unitPrice: true, quantity: true, lineTotal: true, weightGrams: true }, orderBy: { position: "asc" as const } },
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

  getForCustomer(storeId: string, customerId: string, id: string) {
    return this.one({ storeId, customerId, id });
  }

  async listForCustomer(storeId: string, customerId: string, limit: number): Promise<OrderView[]> {
    const rows = await db.order.findMany({ where: { storeId, customerId }, select: orderSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit });
    return rows.map(toView);
  }

  async list(storeId: string, q: { status?: OrderStatus; before?: string; limit: number }): Promise<OrderListPage> {
    const where: Prisma.OrderWhereInput = { storeId, ...(q.status ? { status: q.status } : {}) };
    if (q.before) {
      // Keyset: strictly older than the cursor order (of THIS store; a foreign or unknown cursor is an empty page).
      const c = await db.order.findFirst({ where: { storeId, id: q.before }, select: { createdAt: true, id: true } });
      if (!c) return { items: [], nextCursor: null };
      where.OR = [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }];
    }
    const rows = await db.order.findMany({ where, select: orderSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: q.limit + 1 });
    const page = rows.slice(0, q.limit).map(toView);
    return { items: page, nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null };
  }

  async create(o: NewOrder, holdLines: number, cartId: string | null, now: Date): Promise<OrderView | "hold_lost" | "duplicate"> {
    try {
      await db.$transaction(async (tx) => {
        const scope = { tx };
        // 1. the stock hold becomes the order's stock (or nothing happens)
        if (!(await consumeReservationInTx(scope, o.storeId, o.id, now, holdLines))) throw new HoldLost();
        // 2. the next number: the counter row is locked until commit, so numbers are unique and a rollback leaves no gap
        const [counter] = await tx.$queryRaw<{ n: number }[]>`
          INSERT INTO "StoreCounter" ("storeId", "lastOrderNumber") VALUES (${o.storeId}, 1)
          ON CONFLICT ("storeId") DO UPDATE SET "lastOrderNumber" = "StoreCounter"."lastOrderNumber" + 1
          RETURNING "lastOrderNumber" AS n`;
        // 3. the snapshot
        await tx.order.create({
          data: {
            id: o.id, storeId: o.storeId, number: counter!.n, status: "PLACED", customerId: o.customerId, requestKey: o.requestKey, accessTokenHash: o.accessTokenHash,
            recipientName: o.address.recipientName, phone: o.address.phone, province: o.address.province, city: o.address.city, addressLine: o.address.line, postalCode: o.address.postalCode,
            shippingMethodId: o.shipping.methodId, shippingName: o.shipping.name, shippingKind: o.shipping.kind, shippingCost: BigInt(o.shipping.cost),
            paymentMethod: o.paymentMethod, codFee: BigInt(o.codFee), subtotal: BigInt(o.subtotal), total: BigInt(o.total), itemCount: o.itemCount, note: o.note,
          },
        });
        await tx.orderItem.createMany({ data: o.items.map((i) => ({ ...i, storeId: o.storeId, orderId: o.id, lineTotal: BigInt(i.lineTotal) })) });
        await tx.orderEvent.create({ data: { storeId: o.storeId, orderId: o.id, fromStatus: null, toStatus: "PLACED", actor: "CUSTOMER", actorId: o.customerId } });
        // 4. consumers (order SMS, 3.6) re-read the order; the event carries ids only, never personal data
        await recordEvent(scope, { type: "order.placed", storeId: o.storeId, payload: { orderId: o.id, number: counter!.n } });
        // 5. the cart is emptied with the order
        if (cartId) await clearCartInTx(scope, o.storeId, cartId);
      }, TX);
    } catch (e) {
      if (e instanceof HoldLost) return "hold_lost";
      if (prismaCode(e) === "P2002") return "duplicate"; // the same request key committed first
      throw e;
    }
    return (await this.getById(o.storeId, o.id))!;
  }

  async transition(
    storeId: string,
    id: string,
    to: OrderStatus,
    check: (current: OrderStatus) => void,
    by: { actor: "CUSTOMER" | "MERCHANT" | "SYSTEM"; actorId: string | null; note: string },
  ): Promise<OrderView | null> {
    const done = await db.$transaction(async (tx) => {
      // Lock order: the order row first, then (cancellation) product rows and reservation rows, as the stock ledger does.
      const [row] = await tx.$queryRaw<{ status: OrderStatus }[]>`SELECT status::text AS status FROM "Order" WHERE id = ${id} AND "storeId" = ${storeId} FOR UPDATE`;
      if (!row) return false;
      check(row.status);
      await tx.order.updateMany({ where: { id, storeId, status: row.status }, data: { status: to } });
      await tx.orderEvent.create({ data: { storeId, orderId: id, fromStatus: row.status, toStatus: to, actor: by.actor, actorId: by.actorId, note: by.note } });
      if (restocksOn(to)) await restockReservationInTx({ tx }, storeId, id);
      await recordEvent({ tx }, { type: "order.status_changed", storeId, payload: { orderId: id, from: row.status, to } });
      return true;
    }, TX);
    return done ? this.getById(storeId, id) : null;
  }
}
