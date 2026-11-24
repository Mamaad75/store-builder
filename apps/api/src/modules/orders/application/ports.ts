import type { OrderActor, OrderStatus, PaymentMethod } from "@store-builder/shared/modules/orders/orders";
import type { AddressInput } from "@store-builder/shared/modules/checkout/checkout";
import type { NewOrder, OrderView, ReadySummary } from "../domain/orders.js";

/** Who is shopping (the checkout module reads it from the request: cart cookie, customer session of this store, network key). */
export interface Shopper {
  cartToken: string | null;
  customerId: string | null;
  /** Phase 3.3b: the signed-in customer's phone is proven by an SMS code (orders attached to the phone from guest checkouts are theirs). */
  customerVerified?: boolean;
  ipKey: string;
}

/** The checkout (phase 3.3): orders are priced exactly like the checkout summary, by the checkout module itself. */
export interface CheckoutPort {
  liveStoreId(label: string): Promise<string>;
  prepareOrder(
    label: string,
    s: Shopper,
    q: { address?: unknown; addressId?: string; shippingMethodId: string; cashOnDelivery: boolean },
  ): Promise<{ storeId: string; summary: ReadySummary; address: AddressInput | null; cartId: string | null; weights: Map<string, number | null> }>;
}

export interface OrderListPage {
  items: OrderView[];
  /** Pass as `before` for the next (older) page; null on the last page. */
  nextCursor: string | null;
}

/** Orders of one store. Every query is bound to the store id (and, for shoppers, to the customer or the access token). */
export interface OrderStore {
  findByRequestKey(storeId: string, requestKey: string): Promise<OrderView | null>;
  /**
   * ONE transaction: the stock hold `order.id` is consumed (all `holdLines` lines, unexpired), the next gap-free number is taken, the order
   * with its items and first history entry is written, the "order.placed" event is recorded and the cart is emptied. "hold_lost" = the
   * hold was incomplete (nothing written). A second order with the same request key fails with "duplicate" (nothing written).
   */
  create(order: NewOrder, holdLines: number, cartId: string | null, now: Date): Promise<OrderView | "hold_lost" | "duplicate">;
  getById(storeId: string, id: string): Promise<OrderView | null>;
  getByTokenHash(storeId: string, tokenHash: string): Promise<OrderView | null>;
  /** `includePhoneLinked`: also orders attached by phone from guest checkouts (only for a customer whose phone is verified, phase 3.3b). */
  getForCustomer(storeId: string, customerId: string, id: string, includePhoneLinked: boolean): Promise<OrderView | null>;
  listForCustomer(storeId: string, customerId: string, limit: number, includePhoneLinked: boolean): Promise<OrderView[]>;
  /** Phase 3.3b: per customer, their orders' count and the total of those not cancelled (merchant's customer list). */
  customerStats(storeId: string, customerIds: string[]): Promise<{ customerId: string; orders: number; spent: number; lastOrderAt: string | null }[]>;
  list(storeId: string, q: { status?: OrderStatus; customerId?: string; before?: string; limit: number }): Promise<OrderListPage>;
  /**
   * ONE transaction with the order row locked: `check(current)` throws when the move is not allowed (nothing changes); otherwise the
   * status changes, the history gets an entry, a cancellation gives the stock back and "order.status_changed" is recorded. null = no such order.
   */
  transition(
    storeId: string,
    id: string,
    to: OrderStatus,
    /** Throws when the move is not allowed; gets the current status and the order's payment method. */
    check: (current: OrderStatus, paymentMethod: PaymentMethod) => void,
    by: { actor: OrderActor; actorId: string | null; note: string },
  ): Promise<OrderView | null>;
}

/** The stock hold (the 3.2 ledger): taken before the order is written, consumed inside its transaction, released if writing fails. */
export interface StockHold {
  reserve(storeId: string, ref: string, lines: { productId: string; variantId: string | null; quantity: number }[], ttlSeconds: number): Promise<void>;
  release(storeId: string, ref: string): Promise<number>;
}

/** Order access tokens: derived from the order id with a server key (so a retried request can be answered with the same token). */
export interface OrderTokens {
  tokenFor(orderId: string): string;
  /** null = not a token this system could have issued (never looked up). */
  hash(token: string): string | null;
  /**
   * The stored idempotency key: the client's requestKey bound to WHO is checking out (the customer, else the cart cookie), so the same
   * requestKey from anyone else is simply a different key (review 3.4: it never returns someone else's order). 64 hex characters.
   */
  requestKeyFor(requestKey: string, owner: string): string;
}

export interface Limiter {
  consume(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

// ---------- phase 3.5 (D35-1): online payment ----------

export interface GatewayRequest {
  sandbox: boolean;
  merchantId: string;
  amountRial: number;
  description: string;
  callbackUrl: string;
  /** Shown in the merchant's Zarinpal panel: the order number. */
  orderRef: string;
  mobile: string | null;
}
export interface GatewayVerify {
  sandbox: boolean;
  merchantId: string;
  amountRial: number;
  authority: string;
}
export interface GatewayInquiry {
  sandbox: boolean;
  merchantId: string;
  authority: string;
}
export type VerifyResult =
  | { outcome: "paid"; code: number; refId: string; cardPan: string | null; fee: number | null }
  | { outcome: "failed"; code: number }
  /** No answer, an answer we do not understand, or a temporary error: the attempt is checked again later (never settled on a guess). */
  | { outcome: "unknown"; code?: number | null };

/** The payment provider (Zarinpal REST v4). Never throws: every failure is a result. */
export interface PaymentGateway {
  startUrl(sandbox: boolean, authority: string): string;
  request(r: GatewayRequest): Promise<{ ok: true; authority: string } | { ok: false; code: number | null }>;
  verify(v: GatewayVerify): Promise<VerifyResult>;
  inquiry(q: GatewayInquiry): Promise<{ status: "VERIFIED" | "PAID" | "IN_BANK" | "FAILED" | "REVERSED" | "unknown" }>;
}

/** What decides whether a store can take online payments: the platform switch, sandbox mode, and the store's own merchant id. */
export interface PaymentConfig {
  platform(): Promise<{ enabled: boolean; sandbox: boolean }>;
  /** The store's Zarinpal merchant id, or null (not set, or secrets not configured on this server). */
  merchantId(storeId: string): Promise<string | null>;
  /** false when the server has no master keys: no merchant id can be stored. */
  secretsReady(): boolean;
  /** SHA-256 hex of a merchant id (an attempt is verified only with the merchant id it was opened with). */
  fingerprint(merchantId: string): string;
  /** A random return key for the paying browser and its SHA-256 hex (only the hash is stored). */
  newReturnKey(): { key: string; hash: string };
  /** SHA-256 hex of a presented return key; null when it is not shaped like one. */
  hashReturnKey(key: string): string | null;
}

export type AttemptStatus = "CREATED" | "VERIFYING" | "PAID" | "FAILED" | "EXPIRED" | "REFUND_REQUIRED";

export interface PaymentAttempt {
  id: string;
  storeId: string;
  orderId: string;
  sandbox: boolean;
  authority: string;
  amountRial: number;
  status: AttemptStatus;
  createdAt: Date;
  claimedAt: Date | null;
  /** A verify call was sent and its answer was lost: the attempt is never closed without a definite answer (review 3.5). */
  verifySentAt: Date | null;
  merchantFingerprint: string;
  returnKeyHash: string;
  checks: number;
}

/** Claiming an attempt for verification: only one attempt of an order is verified at a time. */
export type ClaimResult =
  | { ok: true; attempt: PaymentAttempt }
  /**
   * paid: the order is paid (by this attempt, or by another: then this one is closed unverified and Zarinpal refunds it);
   * closed: the order was cancelled or expired; busy: another verification of this order is running; failed: this attempt is settled unpaid.
   * An attempt whose verify answer was lost is claimed even on a closed order (its money may already be captured).
   */
  | { ok: false; reason: "not_found" | "paid" | "busy" | "closed" | "failed" };

export interface OrderForPayment {
  number: number;
  status: string;
  total: number;
  phone: string;
  deadline: Date | null;
  storeName: string;
  customerId: string | null;
  linkedByPhone: boolean;
}

export interface PaymentStore {
  /** What a payment needs from the order (null = no such order in this store). */
  orderForPayment(storeId: string, orderId: string): Promise<OrderForPayment | null>;
  /** Locks the order: AWAITING_PAYMENT, before the deadline, fewer than `maxAttempts` attempts, none being verified -> may start. */
  canStart(storeId: string, orderId: string, now: Date, maxAttempts: number): Promise<"ok" | "closed" | "too_many" | "busy">;
  /** The same checks again under the lock, then the attempt is written (a refused one is never verified: Zarinpal refunds it). */
  record(
    a: { id: string; storeId: string; orderId: string; sandbox: boolean; authority: string; amountRial: number; merchantFingerprint: string; returnKeyHash: string },
    now: Date,
    maxAttempts: number,
  ): Promise<"ok" | "closed" | "too_many" | "busy">;
  byAuthority(storeId: string, authority: string): Promise<PaymentAttempt | null>;
  /** ONE transaction, order row locked first: CREATED (or a VERIFYING one claimed before `staleBefore`) -> VERIFYING, verify marked as sent. */
  claim(storeId: string, authority: string, now: Date, staleBefore: Date): Promise<ClaimResult>;
  /**
   * ONE transaction: an order still awaiting payment -> the attempt PAID and the order PLACED (history, "order.placed"), its other
   * attempts that never sent a verify closed; an order no longer payable -> the attempt REFUND_REQUIRED (captured money the merchant must
   * return). false = the attempt was not ours to settle (claim lost).
   */
  settlePaid(attemptId: string, claimedAt: Date, r: { refId: string; cardPan: string | null; fee: number | null; code: number }, now: Date): Promise<"placed" | "refund" | false>;
  /** The attempt -> FAILED (a definite answer) or EXPIRED (never used). With `claimedAt`: only while that claim holds. */
  settleUnpaid(attemptId: string, status: "FAILED" | "EXPIRED", code: number | null, claimedAt?: Date | null): Promise<void>;
  /** Back to CREATED after an answer that settles nothing; `answered` = the gateway answered (the verify did not capture: sent-mark cleared). */
  release(attemptId: string, claimedAt: Date, code: number | null, answered: boolean): Promise<void>;
  /** Reconciler back-off: check this attempt again at `next`. */
  defer(attemptId: string, next: Date): Promise<void>;
  /** Reconciler: CREATED attempts due (created before `olderThan`, nextCheckAt passed), and VERIFYING ones claimed before `staleBefore`. */
  pending(now: Date, olderThan: Date, staleBefore: Date, limit: number): Promise<PaymentAttempt[]>;
  /** The open (CREATED/VERIFYING) attempts of one order. */
  openAttempts(storeId: string, orderId: string): Promise<PaymentAttempt[]>;
  /** Reconciler: unpaid online orders whose deadline passed before `before`. */
  expirable(before: Date, limit: number): Promise<{ storeId: string; orderId: string }[]>;
  /**
   * ONE transaction, order row locked: still AWAITING_PAYMENT, deadline before `before`, no attempt being verified or with a lost verify
   * answer -> EXPIRED (history by SYSTEM, stock back, "order.status_changed"), its open attempts -> EXPIRED (never verified, so Zarinpal
   * returns any money). false = not expired.
   */
  expire(storeId: string, orderId: string, before: Date): Promise<boolean>;
  /** The store's subdomain label (its storefront address, also the payment return address), null if none. */
  labelOf(storeId: string): Promise<string | null>;
  /** Per order, for the order pages. */
  forOrder(storeId: string, orderId: string): Promise<{ status: AttemptStatus; refId: string | null; cardPan: string | null; createdAt: Date; verifiedAt: Date | null }[]>;
}

// ---------- D35b-1: card-to-card ----------

export interface BankCard {
  cardNumber: string;
  holderName: string;
  bankName: string;
}

export interface ReceiptView {
  id: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  trackingCode: string;
  payerCardLast4: string;
  reviewNote: string;
  createdAt: string;
  reviewedAt: string | null;
}

/** What the shopper sees on a card-to-card order: where to transfer, what was sent, whether another receipt can be sent now. */
export interface TransferInfo {
  cards: BankCard[];
  receipts: Omit<ReceiptView, "id" | "trackingCode">[];
  canSubmit: boolean;
}

/** Bank cards and receipts of one store. Every query is bound to the store id. */
export interface TransferStore {
  cards(storeId: string): Promise<BankCard[]>;
  replaceCards(storeId: string, cards: BankCard[]): Promise<BankCard[]>;
  /** null = no such order in this store. */
  receipts(storeId: string, orderId: string): Promise<ReceiptView[] | null>;
  /**
   * ONE transaction, order row locked: a CARD_TRANSFER order still AWAITING_PAYMENT before its deadline, no receipt under review, fewer
   * than `max` receipts -> the receipt is written (SUBMITTED).
   */
  submit(
    r: { storeId: string; orderId: string; trackingCode: string; payerCardLast4: string; image: Buffer; width: number; height: number },
    now: Date,
    max: number,
  ): Promise<"ok" | "closed" | "pending" | "too_many">;
  /** The same checks as submit, without a lock: refuses early before an image is processed (submit checks again under the lock). */
  canSubmit(storeId: string, orderId: string, now: Date, max: number): Promise<"ok" | "closed" | "pending" | "too_many">;
  image(storeId: string, orderId: string, receiptId: string): Promise<{ bytes: Buffer; mime: string } | null>;
  /**
   * ONE transaction, order row locked. approve: the receipt APPROVED and the order AWAITING_PAYMENT -> PLACED (history by the merchant,
   * "order.placed"); reject: the receipt REJECTED with the note, the order's deadline moved to at least `resubmitUntil`.
   */
  review(
    storeId: string,
    orderId: string,
    receiptId: string,
    d: { decision: "approve" | "reject"; note: string; actorId: string },
    now: Date,
    resubmitUntil: Date,
    /** No extension once the order has this many receipts (nothing more can be sent). */
    max: number,
  ): Promise<"approved" | "rejected" | "not_found" | "not_pending">;
}

/** Re-encodes an uploaded receipt (no metadata survives); throws MediaValidationError for anything that is not a sane still image. */
export type ReceiptImageProcessor = (bytes: Buffer) => Promise<{ buffer: Buffer; width: number; height: number }>;
