import {
  MAX_RECEIPTS_PER_ORDER,
  RESUBMIT_WINDOW_HOURS,
  maskCardNumber,
  receiptFieldsSchema,
  replaceBankCardsSchema,
  reviewReceiptSchema,
} from "@store-builder/shared/modules/orders/card-transfer";
import { OrderRateLimitedError, PaymentUnavailableError, ReceiptNotAllowedError } from "@store-builder/shared/modules/orders/errors";
import { can, type StoreRole } from "@store-builder/shared/modules/access/permissions";
import { PermissionDeniedError } from "@store-builder/shared/modules/access/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import type { z } from "zod";
import type { OrderView } from "../domain/orders.js";
import type { BankCard, Limiter, ReceiptImageProcessor, ReceiptView, TransferInfo, TransferStore } from "./ports.js";

const ID_RE = /^[a-z0-9]{1,64}$/;
/** Receipts sent per network per store per hour (each is an image the server re-encodes). */
const RECEIPT_RULE = { limit: 10, windowSeconds: 3600 } as const;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of r.error.issues) (fieldErrors[String(i.path[0] ?? "_")] ??= []).push(i.message);
    throw new ValidationError(fieldErrors);
  }
  return r.data;
}

/**
 * Card-to-card payment (D35b-1). The merchant lists bank cards; a CARD_TRANSFER order waits for a receipt (image + bank tracking number +
 * last 4 digits of the paying card); the merchant approves it (order PLACED) or rejects it with a note (the shopper may send another).
 * Receipt images are re-encoded by the media pipeline and are readable only by the store's staff.
 */
export class TransfersService {
  constructor(
    private readonly store: TransferStore,
    private readonly processImage: ReceiptImageProcessor,
    private readonly limiter: Limiter,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  // ---------- the store's cards ----------

  /**
   * The merchant's view (D-22 / V0-6): full numbers only for a role with `payout.manage` (the owner); masked (603799******7893) for managers
   * and operators. Shoppers get the full numbers of their own unpaid order elsewhere (transferInfo), as before.
   */
  async cards(a: { storeId: string; role: StoreRole }): Promise<{ canManage: boolean; cards: BankCard[] }> {
    const cards = await this.store.cards(a.storeId);
    const canManage = can(a.role, "payout.manage");
    return { canManage, cards: canManage ? cards : cards.map((c) => ({ ...c, cardNumber: maskCardNumber(c.cardNumber) })) };
  }

  /** D-3 / V0-1: create, replace or remove (empty list) the cards: owner only (the guard checks `payout.manage`; checked again here). */
  async replaceCards(a: { storeId: string; actorId: string; role: StoreRole }, body: unknown): Promise<{ canManage: boolean; cards: BankCard[] }> {
    if (!can(a.role, "payout.manage")) throw new PermissionDeniedError("payout.manage");
    await this.store.replaceCards(a.storeId, parse(replaceBankCardsSchema, body).cards, { actorId: a.actorId, role: a.role });
    return this.cards(a);
  }

  async available(storeId: string): Promise<boolean> {
    return (await this.store.cards(storeId)).length > 0;
  }

  async assertAvailable(storeId: string): Promise<void> {
    if (!(await this.available(storeId))) throw new PaymentUnavailableError("no_cards");
  }

  // ---------- shoppers ----------

  /** For a card-to-card order: the cards to pay to (while it waits), the receipts sent so far (no tracking number back) and whether another can be sent. */
  async shopperInfo(storeId: string, order: OrderView): Promise<TransferInfo | null> {
    if (order.paymentMethod !== "CARD_TRANSFER") return null;
    const waiting = order.status === "AWAITING_PAYMENT";
    const receipts = (await this.store.receipts(storeId, order.id)) ?? [];
    const open = waiting && order.paymentDeadline !== null && new Date(order.paymentDeadline) > this.clock();
    return {
      cards: waiting ? await this.store.cards(storeId) : [],
      receipts: receipts.map(({ status, payerCardLast4, reviewNote, createdAt, reviewedAt }) => ({ status, payerCardLast4, reviewNote, createdAt, reviewedAt })),
      canSubmit: open && !receipts.some((r) => r.status === "SUBMITTED") && receipts.length < MAX_RECEIPTS_PER_ORDER,
    };
  }

  /** A receipt for the order: fields from the query string, the image as the raw body. */
  async submit(storeId: string, orderId: string, image: unknown, fields: unknown, ipKey: string): Promise<void> {
    const f = parse(receiptFieldsSchema, fields);
    if (!Buffer.isBuffer(image) || image.length === 0) throw new ValidationError({ image: ["تصویر رسید را انتخاب کنید"] });
    const r = await this.limiter.consume(`receipt:${storeId}:ip:${ipKey}`, RECEIPT_RULE);
    if (!r.allowed) throw new OrderRateLimitedError(r.retryAfterSeconds);
    const perOrder = await this.limiter.consume(`receipt:${storeId}:order:${orderId}`, RECEIPT_RULE);
    if (!perOrder.allowed) throw new OrderRateLimitedError(perOrder.retryAfterSeconds);
    // Review D35b-1: refuse before spending an image re-encode on an order that takes no receipt now.
    const can = await this.store.canSubmit(storeId, orderId, this.clock(), MAX_RECEIPTS_PER_ORDER);
    if (can !== "ok") throw new ReceiptNotAllowedError(can);
    const img = await this.processImage(image); // MediaValidationError for anything that is not a sane still image
    const out = await this.store.submit({ storeId, orderId, ...f, image: img.buffer, width: img.width, height: img.height }, this.clock(), MAX_RECEIPTS_PER_ORDER);
    if (out !== "ok") throw new ReceiptNotAllowedError(out);
  }

  // ---------- merchants (store access already checked by the guard) ----------

  async receipts(a: { storeId: string }, orderId: string): Promise<ReceiptView[]> {
    const r = ID_RE.test(orderId) ? await this.store.receipts(a.storeId, orderId) : null;
    if (!r) throw new NotFoundError();
    return r;
  }

  async image(a: { storeId: string }, orderId: string, receiptId: string): Promise<{ bytes: Buffer; mime: string }> {
    const r = ID_RE.test(orderId) && ID_RE.test(receiptId) ? await this.store.image(a.storeId, orderId, receiptId) : null;
    if (!r) throw new NotFoundError();
    return r;
  }

  async review(a: { storeId: string; actorId: string }, orderId: string, receiptId: string, body: unknown): Promise<"approved" | "rejected"> {
    if (!ID_RE.test(orderId) || !ID_RE.test(receiptId)) throw new NotFoundError();
    const q = parse(reviewReceiptSchema, body);
    const now = this.clock();
    const r = await this.store.review(a.storeId, orderId, receiptId, { decision: q.decision, note: q.reason, actorId: a.actorId }, now, new Date(now.getTime() + RESUBMIT_WINDOW_HOURS * 3600_000), MAX_RECEIPTS_PER_ORDER);
    if (r === "not_found") throw new NotFoundError();
    if (r === "not_pending") throw new ReceiptNotAllowedError("closed");
    return r;
  }
}
