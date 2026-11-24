import type { Prisma } from "@prisma/client";
import { db } from "../../../lib/db.js";
import { recordEvent } from "../../../platform/outbox/outbox.js";
import type { BankCard, ReceiptView, TransferStore } from "../application/ports.js";

// D35b-1: bank cards and card-to-card receipts. Lock order: the Order row first, then its receipts (as payments do).

const TX = { timeout: 10_000, maxWait: 5_000 } as const;
type Tx = Prisma.TransactionClient;

const receiptSelect = { id: true, status: true, trackingCode: true, payerCardLast4: true, reviewNote: true, createdAt: true, reviewedAt: true } satisfies Prisma.TransferReceiptSelect;
const toReceipt = (r: Prisma.TransferReceiptGetPayload<{ select: typeof receiptSelect }>): ReceiptView => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
});

async function lockOrder(tx: Tx, storeId: string, orderId: string) {
  const [row] = await tx.$queryRaw<{ status: string; method: string; paymentDeadline: Date | null; number: number }[]>`
    SELECT status::text AS status, "paymentMethod"::text AS method, "paymentDeadline", number FROM "Order" WHERE id = ${orderId} AND "storeId" = ${storeId} FOR UPDATE`;
  return row ?? null;
}

export class PrismaTransferStore implements TransferStore {
  async cards(storeId: string): Promise<BankCard[]> {
    return db.storeBankCard.findMany({ where: { storeId }, select: { cardNumber: true, holderName: true, bankName: true }, orderBy: { position: "asc" } });
  }

  async replaceCards(storeId: string, cards: BankCard[]): Promise<BankCard[]> {
    await db.$transaction(async (tx) => {
      // Review D35b-1: two saves at once are serialised on the store row (no unique-index failure halfway through).
      await tx.$queryRaw`SELECT id FROM "Store" WHERE id = ${storeId} FOR UPDATE`;
      await tx.storeBankCard.deleteMany({ where: { storeId } });
      if (cards.length) await tx.storeBankCard.createMany({ data: cards.map((c, position) => ({ ...c, storeId, position })) });
    }, TX);
    return this.cards(storeId);
  }

  async receipts(storeId: string, orderId: string) {
    const exists = await db.order.findFirst({ where: { storeId, id: orderId }, select: { id: true } });
    if (!exists) return null;
    const rows = await db.transferReceipt.findMany({ where: { storeId, orderId }, select: receiptSelect, orderBy: { createdAt: "asc" } });
    return rows.map(toReceipt);
  }

  async submit(
    r: { storeId: string; orderId: string; trackingCode: string; payerCardLast4: string; image: Buffer; width: number; height: number },
    now: Date,
    max: number,
  ) {
    return db.$transaction(async (tx) => {
      const o = await lockOrder(tx, r.storeId, r.orderId);
      if (!o || o.method !== "CARD_TRANSFER" || o.status !== "AWAITING_PAYMENT" || !o.paymentDeadline || o.paymentDeadline <= now) return "closed" as const;
      const existing = await tx.transferReceipt.findMany({ where: { storeId: r.storeId, orderId: r.orderId }, select: { status: true } });
      if (existing.some((x) => x.status === "SUBMITTED")) return "pending" as const;
      if (existing.length >= max) return "too_many" as const;
      await tx.transferReceipt.create({
        data: {
          storeId: r.storeId, orderId: r.orderId, trackingCode: r.trackingCode, payerCardLast4: r.payerCardLast4,
          image: new Uint8Array(r.image), imageMime: "image/webp", imageWidth: r.width, imageHeight: r.height,
        },
      });
      return "ok" as const;
    }, TX);
  }

  async canSubmit(storeId: string, orderId: string, now: Date, max: number) {
    const o = await db.order.findFirst({ where: { storeId, id: orderId }, select: { status: true, paymentMethod: true, paymentDeadline: true, receipts: { select: { status: true } } } });
    if (!o || o.paymentMethod !== "CARD_TRANSFER" || o.status !== "AWAITING_PAYMENT" || !o.paymentDeadline || o.paymentDeadline <= now) return "closed" as const;
    if (o.receipts.some((r) => r.status === "SUBMITTED")) return "pending" as const;
    return o.receipts.length >= max ? ("too_many" as const) : ("ok" as const);
  }

  async image(storeId: string, orderId: string, receiptId: string) {
    const r = await db.transferReceipt.findFirst({ where: { storeId, orderId, id: receiptId }, select: { image: true, imageMime: true } });
    return r ? { bytes: Buffer.from(r.image), mime: r.imageMime } : null;
  }

  async review(storeId: string, orderId: string, receiptId: string, d: { decision: "approve" | "reject"; note: string; actorId: string }, now: Date, resubmitUntil: Date, max: number) {
    return db.$transaction(async (tx) => {
      const o = await lockOrder(tx, storeId, orderId);
      if (!o) return "not_found" as const;
      const [rc] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM "TransferReceipt" WHERE id = ${receiptId} AND "storeId" = ${storeId} AND "orderId" = ${orderId} FOR UPDATE`;
      if (!rc) return "not_found" as const;
      if (rc.status !== "SUBMITTED") return "not_pending" as const;
      if (d.decision === "reject") {
        await tx.transferReceipt.update({ where: { id: receiptId }, data: { status: "REJECTED", reviewNote: d.note, reviewedById: d.actorId, reviewedAt: now } });
        // The shopper gets time again to send a corrected receipt (an order past its deadline was kept only because of this receipt).
        const sent = await tx.transferReceipt.count({ where: { storeId, orderId } });
        if (o.status === "AWAITING_PAYMENT" && o.paymentDeadline && o.paymentDeadline < resubmitUntil && sent < max) {
          await tx.order.update({ where: { storeId_id: { storeId, id: orderId } }, data: { paymentDeadline: resubmitUntil } });
        }
        return "rejected" as const;
      }
      if (o.status !== "AWAITING_PAYMENT" || o.method !== "CARD_TRANSFER") return "not_pending" as const;
      // Defence in depth (review D35b-1): never place an order that a gateway payment may be settling at the same time.
      const busy = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Payment" WHERE "storeId" = ${storeId} AND "orderId" = ${orderId}
          AND (status IN ('VERIFYING', 'PAID') OR (status = 'CREATED' AND "verifySentAt" IS NOT NULL)) FOR UPDATE`;
      if (busy.length) return "not_pending" as const;
      await tx.transferReceipt.update({ where: { id: receiptId }, data: { status: "APPROVED", reviewNote: d.note, reviewedById: d.actorId, reviewedAt: now } });
      await tx.order.update({ where: { storeId_id: { storeId, id: orderId } }, data: { status: "PLACED" } });
      await tx.orderEvent.create({ data: { storeId, orderId, fromStatus: "AWAITING_PAYMENT", toStatus: "PLACED", actor: "MERCHANT", actorId: d.actorId, note: "رسید کارت به کارت تأیید شد" } });
      await recordEvent({ tx }, { type: "order.placed", storeId, payload: { orderId, number: o.number } });
      return "approved" as const;
    }, TX);
  }
}
