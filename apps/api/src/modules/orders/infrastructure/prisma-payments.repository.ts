import type { Prisma } from "@prisma/client";
import { db } from "../../../lib/db.js";
import { recordEvent } from "../../../platform/outbox/outbox.js";
import { restockReservationInTx } from "../../inventory/inventory.api.js";
import type { ClaimResult, OrderForPayment, PaymentAttempt, PaymentStore } from "../application/ports.js";

// Phase 3.5 (D35-1): the Payment table. Lock order everywhere: the Order row first, then its Payment rows (as orders do with stock rows).

const TX = { timeout: 10_000, maxWait: 5_000 } as const;
type Tx = Prisma.TransactionClient;

const attemptSelect = {
  id: true, storeId: true, orderId: true, sandbox: true, authority: true, amountRial: true, status: true, createdAt: true, claimedAt: true,
  verifySentAt: true, merchantFingerprint: true, returnKeyHash: true, checks: true,
} satisfies Prisma.PaymentSelect;
const toAttempt = (r: Prisma.PaymentGetPayload<{ select: typeof attemptSelect }>): PaymentAttempt => ({ ...r, amountRial: Number(r.amountRial) });

async function lockOrder(tx: Tx, storeId: string, orderId: string) {
  const [row] = await tx.$queryRaw<{ status: string; method: string; paymentDeadline: Date | null; number: number }[]>`
    SELECT status::text AS status, "paymentMethod"::text AS method, "paymentDeadline", number FROM "Order" WHERE id = ${orderId} AND "storeId" = ${storeId} FOR UPDATE`;
  return row ?? null;
}

type LockedAttempt = { id: string; status: string; claimedAt: Date | null; verifySentAt: Date | null };
async function lockAttempts(tx: Tx, storeId: string, orderId: string) {
  return tx.$queryRaw<LockedAttempt[]>`
    SELECT id, status::text AS status, "claimedAt", "verifySentAt" FROM "Payment" WHERE "storeId" = ${storeId} AND "orderId" = ${orderId} ORDER BY "createdAt" FOR UPDATE`;
}

/** An attempt that may hold captured money: being verified, or a verify was sent and its answer was lost. Blocks cancel and expiry. */
export const holdsMoney = (a: { status: string; verifySentAt: Date | null }) =>
  a.status === "VERIFYING" || a.status === "PAID" || (a.status === "CREATED" && a.verifySentAt !== null);

function startable(o: { status: string; method: string; paymentDeadline: Date | null } | null, attempts: LockedAttempt[], now: Date, max: number) {
  // Review D35b-1: only an ONLINE order is paid through a gateway (a card-to-card order is paid by transfer and the merchant's approval).
  if (!o || o.method !== "ONLINE" || o.status !== "AWAITING_PAYMENT" || !o.paymentDeadline || o.paymentDeadline <= now) return "closed" as const;
  if (attempts.some(holdsMoney)) return "busy" as const;
  return attempts.length >= max ? ("too_many" as const) : ("ok" as const);
}

export class PrismaPaymentStore implements PaymentStore {
  async orderForPayment(storeId: string, orderId: string): Promise<OrderForPayment | null> {
    const o = await db.order.findFirst({
      where: { storeId, id: orderId },
      select: { number: true, status: true, total: true, phone: true, paymentDeadline: true, customerId: true, linkedByPhone: true, store: { select: { name: true } } },
    });
    return o
      ? { number: o.number, status: o.status, total: Number(o.total), phone: o.phone, deadline: o.paymentDeadline, storeName: o.store.name, customerId: o.customerId, linkedByPhone: o.linkedByPhone }
      : null;
  }

  async canStart(storeId: string, orderId: string, now: Date, maxAttempts: number) {
    return db.$transaction(async (tx) => {
      const o = await lockOrder(tx, storeId, orderId);
      return startable(o, await lockAttempts(tx, storeId, orderId), now, maxAttempts);
    }, TX);
  }

  async record(
    a: { id: string; storeId: string; orderId: string; sandbox: boolean; authority: string; amountRial: number; merchantFingerprint: string; returnKeyHash: string },
    now: Date,
    maxAttempts: number,
  ) {
    return db.$transaction(async (tx) => {
      const o = await lockOrder(tx, a.storeId, a.orderId);
      const r = startable(o, await lockAttempts(tx, a.storeId, a.orderId), now, maxAttempts);
      if (r === "ok") await tx.payment.create({ data: { ...a, provider: "ZARINPAL", amountRial: BigInt(a.amountRial) } });
      return r;
    }, TX);
  }

  async byAuthority(storeId: string, authority: string) {
    const r = await db.payment.findFirst({ where: { storeId, authority }, select: attemptSelect });
    return r ? toAttempt(r) : null;
  }

  async claim(storeId: string, authority: string, now: Date, staleBefore: Date): Promise<ClaimResult> {
    const p = await db.payment.findFirst({ where: { storeId, authority }, select: { id: true, orderId: true } });
    if (!p) return { ok: false, reason: "not_found" };
    return db.$transaction(async (tx) => {
      const o = await lockOrder(tx, storeId, p.orderId);
      const attempts = await lockAttempts(tx, storeId, p.orderId);
      const me = attempts.find((a) => a.id === p.id);
      if (!o || !me) return { ok: false as const, reason: "not_found" as const };
      if (me.status === "PAID") return { ok: false as const, reason: "paid" as const };
      if (me.status !== "CREATED" && me.status !== "VERIFYING") return { ok: false as const, reason: "failed" as const };
      // One verification per order at a time; one interrupted long ago (claimedAt before staleBefore) may be taken over.
      const live = (a: LockedAttempt) => a.status === "VERIFYING" && a.claimedAt !== null && a.claimedAt >= staleBefore;
      if (attempts.some(live)) return { ok: false as const, reason: "busy" as const };
      // A lost verify answer may mean captured money: such an attempt is verified again whatever happened to the order since.
      if (me.verifySentAt === null) {
        if (attempts.some((a) => a.status === "PAID")) return { ok: false as const, reason: "paid" as const };
        if (o.status !== "AWAITING_PAYMENT") return { ok: false as const, reason: "closed" as const };
      }
      const r = await tx.payment.update({ where: { id: p.id }, data: { status: "VERIFYING", claimedAt: now, verifySentAt: me.verifySentAt ?? now }, select: attemptSelect });
      return { ok: true as const, attempt: toAttempt(r) };
    }, TX);
  }

  async settlePaid(attemptId: string, claimedAt: Date, r: { refId: string; cardPan: string | null; fee: number | null; code: number }, now: Date) {
    const p = await db.payment.findUnique({ where: { id: attemptId }, select: { storeId: true, orderId: true } });
    if (!p) return false;
    return db.$transaction(async (tx) => {
      const o = await lockOrder(tx, p.storeId, p.orderId);
      const attempts = await lockAttempts(tx, p.storeId, p.orderId);
      const me = attempts.find((a) => a.id === attemptId);
      if (!o || !me || me.status !== "VERIFYING" || me.claimedAt?.getTime() !== claimedAt.getTime()) return false as const;
      const paidElsewhere = attempts.some((a) => a.id !== attemptId && a.status === "PAID");
      const placed = o.status === "AWAITING_PAYMENT" && !paidElsewhere;
      await tx.payment.update({
        where: { id: attemptId },
        data: { status: placed ? "PAID" : "REFUND_REQUIRED", refId: r.refId, cardPan: r.cardPan, fee: r.fee === null ? null : BigInt(r.fee), lastCode: r.code, verifiedAt: now },
      });
      if (!placed) return "refund" as const;
      await tx.order.update({ where: { storeId_id: { storeId: p.storeId, id: p.orderId } }, data: { status: "PLACED" } });
      await tx.orderEvent.create({ data: { storeId: p.storeId, orderId: p.orderId, fromStatus: "AWAITING_PAYMENT", toStatus: "PLACED", actor: "SYSTEM", actorId: null, note: "پرداخت اینترنتی تأیید شد" } });
      await recordEvent({ tx }, { type: "order.placed", storeId: p.storeId, payload: { orderId: p.orderId, number: o.number } });
      // Other attempts that never sent a verify are closed (Zarinpal refunds any money in them); one with a lost answer stays open.
      await tx.payment.updateMany({ where: { storeId: p.storeId, orderId: p.orderId, status: "CREATED", verifySentAt: null }, data: { status: "EXPIRED" } });
      return "placed" as const;
    }, TX);
  }

  async settleUnpaid(attemptId: string, status: "FAILED" | "EXPIRED", code: number | null, claimedAt?: Date | null) {
    const where: Prisma.PaymentWhereInput =
      claimedAt
        ? { id: attemptId, status: "VERIFYING", claimedAt }
        : status === "EXPIRED"
          ? { id: attemptId, status: "CREATED", verifySentAt: null } // never close an attempt whose verify answer was lost
          : { id: attemptId, status: { in: ["CREATED", "VERIFYING"] } };
    await db.payment.updateMany({ where, data: { status, lastCode: code, claimedAt: null, ...(status === "FAILED" ? { verifySentAt: null } : {}) } });
  }

  async release(attemptId: string, claimedAt: Date, code: number | null, answered: boolean) {
    await db.payment.updateMany({
      where: { id: attemptId, status: "VERIFYING", claimedAt },
      data: { status: "CREATED", claimedAt: null, lastCode: code, ...(answered ? { verifySentAt: null } : {}) },
    });
  }

  async defer(attemptId: string, next: Date) {
    await db.payment.updateMany({ where: { id: attemptId, status: "CREATED" }, data: { nextCheckAt: next, checks: { increment: 1 } } });
  }

  async pending(now: Date, olderThan: Date, staleBefore: Date, limit: number) {
    const rows = await db.payment.findMany({
      where: { OR: [{ status: "CREATED", createdAt: { lt: olderThan }, nextCheckAt: { lte: now } }, { status: "VERIFYING", claimedAt: { lt: staleBefore } }] },
      select: attemptSelect,
      orderBy: { nextCheckAt: "asc" },
      take: limit,
    });
    return rows.map(toAttempt);
  }

  async openAttempts(storeId: string, orderId: string) {
    const rows = await db.payment.findMany({ where: { storeId, orderId, status: { in: ["CREATED", "VERIFYING"] } }, select: attemptSelect, orderBy: { createdAt: "asc" } });
    return rows.map(toAttempt);
  }

  async expirable(before: Date, limit: number) {
    const rows = await db.order.findMany({
      // Orders whose card-to-card receipt waits for the merchant are not picked (they would crowd out the others on every run).
      where: { status: "AWAITING_PAYMENT", paymentDeadline: { lt: before }, receipts: { none: { status: "SUBMITTED" } } },
      select: { storeId: true, id: true },
      orderBy: { paymentDeadline: "asc" },
      take: limit,
    });
    return rows.map((r) => ({ storeId: r.storeId, orderId: r.id }));
  }

  async expire(storeId: string, orderId: string, before: Date) {
    return db.$transaction(async (tx) => {
      const o = await lockOrder(tx, storeId, orderId);
      if (!o || o.status !== "AWAITING_PAYMENT" || !o.paymentDeadline || o.paymentDeadline >= before) return false;
      if ((await lockAttempts(tx, storeId, orderId)).some(holdsMoney)) return false;
      // D35b-1: a card-to-card receipt waiting for the merchant keeps the order (the shopper may already have paid).
      if (await tx.transferReceipt.count({ where: { storeId, orderId, status: "SUBMITTED" } })) return false;
      await tx.payment.updateMany({ where: { storeId, orderId, status: "CREATED" }, data: { status: "EXPIRED" } });
      await tx.order.update({ where: { storeId_id: { storeId, id: orderId } }, data: { status: "EXPIRED" } });
      await tx.orderEvent.create({ data: { storeId, orderId, fromStatus: "AWAITING_PAYMENT", toStatus: "EXPIRED", actor: "SYSTEM", actorId: null, note: "مهلت پرداخت تمام شد" } });
      await restockReservationInTx({ tx }, storeId, orderId);
      await recordEvent({ tx }, { type: "order.status_changed", storeId, payload: { orderId, from: "AWAITING_PAYMENT", to: "EXPIRED" } });
      return true;
    }, TX);
  }

  async labelOf(storeId: string) {
    return (await db.domain.findFirst({ where: { storeId, kind: "SUBDOMAIN" }, select: { host: true } }))?.host ?? null;
  }

  async forOrder(storeId: string, orderId: string) {
    return db.payment.findMany({
      where: { storeId, orderId },
      select: { status: true, refId: true, cardPan: true, createdAt: true, verifiedAt: true },
      orderBy: { createdAt: "asc" },
    });
  }
}
