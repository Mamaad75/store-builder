import { z } from "zod";
import { normalizeFaText } from "../../lib/text.js";

/**
 * Orders (phase 3.4, D34-1). Pure: shared by the API (rules) and the dashboard/storefront (labels, which buttons to show).
 *
 * Life of an order: PLACED (cash on delivery, or online payment verified) -> CONFIRMED -> SHIPPED -> DELIVERED, or CANCELLED from
 * PLACED or CONFIRMED (the stock goes back on sale). Phase 3.5: an online order starts AWAITING_PAYMENT (stock held) and becomes PLACED when
 * the payment is verified by the server, or EXPIRED (stock back) when the payment window ends. The order number is sequential per store
 * without gaps and is the invoice number.
 */

export const ORDER_STATUSES = ["AWAITING_PAYMENT", "PLACED", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED", "EXPIRED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  AWAITING_PAYMENT: "در انتظار پرداخت",
  PLACED: "ثبت‌شده",
  CONFIRMED: "تأییدشده",
  SHIPPED: "ارسال‌شده",
  DELIVERED: "تحویل‌شده",
  CANCELLED: "لغوشده",
  EXPIRED: "منقضی‌شده (پرداخت نشد)",
};

export type OrderActor = "CUSTOMER" | "MERCHANT" | "SYSTEM";

/** Who may move an order from which status to which. Anything not listed is refused. */
const TRANSITIONS: Readonly<Record<"CUSTOMER" | "MERCHANT", Readonly<Partial<Record<OrderStatus, readonly OrderStatus[]>>>>> = {
  MERCHANT: { AWAITING_PAYMENT: ["CANCELLED"], PLACED: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["SHIPPED", "CANCELLED"], SHIPPED: ["DELIVERED"] },
  // A shopper can change their mind only until the store has confirmed the order (or before paying).
  CUSTOMER: { AWAITING_PAYMENT: ["CANCELLED"], PLACED: ["CANCELLED"] },
  // AWAITING_PAYMENT -> PLACED (payment verified) and -> EXPIRED (window over) are made only by the payment flow itself (SYSTEM).
};

export function canTransition(actor: "CUSTOMER" | "MERCHANT", from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[actor][from]?.includes(to) ?? false;
}

/** The statuses an actor can move this order to next (for buttons). */
export function nextStatuses(actor: "CUSTOMER" | "MERCHANT", from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[actor][from] ?? [];
}

/** Cancelling or expiring gives the order's stock back; no other change touches stock (it left the shelf when the order was placed). */
export const restocksOn = (to: OrderStatus) => to === "CANCELLED" || to === "EXPIRED";

export const PAYMENT_METHODS = ["COD", "ONLINE", "CARD_TRANSFER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = { COD: "پرداخت در محل", ONLINE: "پرداخت اینترنتی", CARD_TRANSFER: "کارت به کارت" };

// ---------- D35c-1: online payment gateways (the shopper picks among those the store has) ----------

export const GATEWAYS = ["ZARINPAL", "AQAYEPARDAKHT"] as const;
export type Gateway = (typeof GATEWAYS)[number];
export const GATEWAY_LABELS: Readonly<Record<Gateway, string>> = { ZARINPAL: "زرین‌پال", AQAYEPARDAKHT: "آقای پرداخت" };
/** Each gateway's amount range in toman (Zarinpal: up to 100,000,000 toman, error -41; Aghaye Pardakht: 1,000 to 400,000,000 toman, error -5). */
export const GATEWAY_TOMAN_RANGE: Readonly<Record<Gateway, readonly [number, number]>> = { ZARINPAL: [100, 100_000_000], AQAYEPARDAKHT: [1_000, 400_000_000] };
/** The store secret that holds each gateway's credential (phase 2.4 envelope encryption). */
export const GATEWAY_SECRETS: Readonly<Record<Gateway, string>> = { ZARINPAL: "payment.zarinpal.merchant_id", AQAYEPARDAKHT: "payment.aqayepardakht.pin" };
/** The shape of each gateway's credential: a Zarinpal merchant id (UUID); an Aghaye Pardakht gateway pin (letters and digits). */
export const GATEWAY_CREDENTIAL_RE: Readonly<Record<Gateway, RegExp>> = {
  ZARINPAL: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  AQAYEPARDAKHT: /^(?!sandbox$)[0-9A-Za-z]{8,64}$/i,
};
/**
 * Whether the gateway returns a payment that is never verified to the buyer by itself (Zarinpal with auto_verify=false does). For a gateway
 * that does not (or does not document it: Aghaye Pardakht), an attempt is never closed unverified: it is verified even on an order that is
 * no longer payable (captured money becomes REFUND_REQUIRED for the merchant) until UNVERIFIED_ATTEMPT_TTL_HOURS after it was opened.
 */
export const GATEWAY_AUTO_REFUNDS: Readonly<Record<Gateway, boolean>> = { ZARINPAL: true, AQAYEPARDAKHT: false };
export const UNVERIFIED_ATTEMPT_TTL_HOURS = 24;
/** A payment session id at each gateway (Zarinpal: authority; Aghaye Pardakht: transid). */
export const GATEWAY_REF_RE: Readonly<Record<Gateway, RegExp>> = { ZARINPAL: /^[AS][0-9A-Za-z]{35}$/, AQAYEPARDAKHT: /^[0-9A-Za-z]{6,40}$/ };
/** Paid before the order is placed (the order waits AWAITING_PAYMENT until then). */
export const isPrepaid = (m: PaymentMethod) => m !== "COD";

// ---------- phase 3.5 (D35-1): online payment ----------

/** How long an online order waits for its payment (stock held meanwhile); then it expires and the stock goes back on sale. */
export const PAYMENT_WINDOW_MINUTES = 20;
/** Payment attempts per order (each one is a new gateway session). */
export const MAX_PAYMENT_ATTEMPTS = 5;
/** The largest online payment of any gateway (Aghaye Pardakht: 400,000,000 toman); each gateway has its own range (GATEWAY_TOMAN_RANGE). */
export const MAX_ONLINE_TOMAN = 400_000_000;
/** The gateway takes rial; the store works in toman. */
export const tomanToRial = (toman: number) => toman * 10;
/** Zarinpal authorities: "A" (live) or "S" (sandbox) and 35 letters/digits. */
export const AUTHORITY_RE = /^[AS][0-9A-Za-z]{35}$/;
/** A Zarinpal merchant id: a 36-character UUID. */
export const ZARINPAL_MERCHANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The store secret that holds the store's own Zarinpal merchant id (phase 2.4 envelope encryption). */
export const ZARINPAL_MERCHANT_SECRET = "payment.zarinpal.merchant_id";

export const PAYMENT_STATUSES = ["CREATED", "VERIFYING", "PAID", "FAILED", "EXPIRED", "REFUND_REQUIRED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  CREATED: "در انتظار پرداخت",
  VERIFYING: "در حال تأیید",
  PAID: "پرداخت‌شده",
  FAILED: "ناموفق",
  EXPIRED: "منقضی‌شده",
  REFUND_REQUIRED: "پرداخت‌شده روی سفارشِ بسته — مبلغ را به خریدار برگردانید",
};

/**
 * The buyer's return from a gateway, as the return page forwards it. Zarinpal: Authority + Status OK|NOK; Aghaye Pardakht: transid +
 * status 1|0 (normalised here to OK|NOK). The status only decides whether a server-side verify is attempted; it proves nothing.
 */
export const verifyPaymentSchema = z
  .object({
    gateway: z.enum(GATEWAYS).default("ZARINPAL"),
    authority: z.string().max(64),
    status: z.enum(["OK", "NOK", "1", "0"]).transform((v) => (v === "OK" || v === "1" ? ("OK" as const) : ("NOK" as const))),
  })
  .strict()
  .refine((v) => GATEWAY_REF_RE[v.gateway].test(v.authority), { message: "شناسه‌ی پرداخت نامعتبر است", path: ["authority"] });

/** Placing orders per client network per store per hour, and per phone per store per day (fake cash-on-delivery orders hold stock). */
export const ORDER_PLACE_RULE = { limit: 20, windowSeconds: 3600 } as const;
export const ORDER_PHONE_RULE = { limit: 10, windowSeconds: 86_400 } as const;
/**
 * And all orders of one store per hour (review 3.4): guest phones are not verified until SMS is on, so rotating numbers and networks
 * could otherwise tie up a store's whole stock with fake cash-on-delivery orders. Generous for a small shop; raise per plan later.
 */
export const ORDER_STORE_RULE = { limit: 200, windowSeconds: 3600 } as const;
/** How long the stock taken for an order being placed is held if the process dies half-way (released by db-cleanup). */
export const ORDER_HOLD_SECONDS = 10 * 60;

const note = z
  .string()
  .transform((v) => normalizeFaText(v))
  .pipe(z.string().max(500, "یادداشت حداکثر ۵۰۰ نویسه است").regex(/^(?:[^\p{Cc}\p{Cs}]|\n)*$/u, "یادداشت نویسه‌ی نامعتبر دارد")) // line breaks allowed, other control characters not
  .default("");

const ID_RE = /^[a-z0-9]{1,64}$/;

/**
 * Placing an order. `requestKey` is made once per checkout page by the client (random): sending the same key again returns the SAME
 * order, so a double click or a retried request never orders twice. Prices and totals are never sent: the server computes them.
 */
export const placeOrderSchema = z
  .object({
    requestKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "شناسه‌ی درخواست نامعتبر است"),
    address: z.unknown().optional(),
    addressId: z.string().regex(ID_RE).optional(),
    shippingMethodId: z.string().regex(ID_RE, "روش ارسال را انتخاب کنید"),
    paymentMethod: z.enum(PAYMENT_METHODS, { error: "روش پرداخت را انتخاب کنید" }),
    /** Phase 5.1: one discount code (case-insensitive). */
    discountCode: z.string().max(64).optional(),
    /** D35c-1: which gateway, for an ONLINE order (default: Zarinpal, for clients of phase 3.5). */
    gateway: z.enum(GATEWAYS, { error: "درگاه پرداخت را انتخاب کنید" }).optional(),
    note,
  })
  .strict()
  .refine((v) => v.paymentMethod === "ONLINE" || v.gateway === undefined, { message: "درگاه فقط برای پرداخت اینترنتی است", path: ["gateway"] });
export type PlaceOrderInput = z.output<typeof placeOrderSchema>;

export const orderTransitionSchema = z.object({ to: z.enum(ORDER_STATUSES, { error: "وضعیت نامعتبر است" }), note }).strict();

export const orderListQuerySchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    /** Phase 3.3b: one customer's orders (the merchant's customer page). */
    customerId: z.string().regex(ID_RE).optional(),
    /** M2: "receipt" = card-to-card orders awaiting payment with a receipt waiting for the merchant's review (the overview's count). */
    review: z.enum(["receipt"]).optional(),
    before: z.string().regex(ID_RE).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
