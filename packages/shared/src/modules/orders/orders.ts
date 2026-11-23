import { z } from "zod";
import { normalizeFaText } from "../../lib/text.js";

/**
 * Orders (phase 3.4, D34-1). Pure: shared by the API (rules) and the dashboard/storefront (labels, which buttons to show).
 *
 * Life of an order: PLACED (cash on delivery; online payment arrives in 3.5) -> CONFIRMED -> SHIPPED -> DELIVERED, or CANCELLED from
 * PLACED or CONFIRMED (the stock goes back on sale). The order number is sequential per store without gaps and is the invoice number.
 */

export const ORDER_STATUSES = ["PLACED", "CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  PLACED: "ثبت‌شده",
  CONFIRMED: "تأییدشده",
  SHIPPED: "ارسال‌شده",
  DELIVERED: "تحویل‌شده",
  CANCELLED: "لغوشده",
};

export type OrderActor = "CUSTOMER" | "MERCHANT" | "SYSTEM";

/** Who may move an order from which status to which. Anything not listed is refused. */
const TRANSITIONS: Readonly<Record<"CUSTOMER" | "MERCHANT", Readonly<Partial<Record<OrderStatus, readonly OrderStatus[]>>>>> = {
  MERCHANT: { PLACED: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["SHIPPED", "CANCELLED"], SHIPPED: ["DELIVERED"] },
  // A shopper can change their mind only until the store has confirmed the order.
  CUSTOMER: { PLACED: ["CANCELLED"] },
};

export function canTransition(actor: "CUSTOMER" | "MERCHANT", from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[actor][from]?.includes(to) ?? false;
}

/** The statuses an actor can move this order to next (for buttons). */
export function nextStatuses(actor: "CUSTOMER" | "MERCHANT", from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[actor][from] ?? [];
}

/** Cancelling gives the order's stock back; no other change touches stock (it left the shelf when the order was placed). */
export const restocksOn = (to: OrderStatus) => to === "CANCELLED";

export const PAYMENT_METHODS = ["COD"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = { COD: "پرداخت در محل" };

/** Placing orders per client network per store per hour, and per phone per store per day (fake cash-on-delivery orders hold stock). */
export const ORDER_PLACE_RULE = { limit: 20, windowSeconds: 3600 } as const;
export const ORDER_PHONE_RULE = { limit: 10, windowSeconds: 86_400 } as const;
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
    paymentMethod: z.enum(PAYMENT_METHODS, { error: "فعلاً فقط پرداخت در محل ممکن است؛ پرداخت آنلاین به‌زودی اضافه می‌شود" }),
    note,
  })
  .strict();
export type PlaceOrderInput = z.output<typeof placeOrderSchema>;

export const orderTransitionSchema = z.object({ to: z.enum(ORDER_STATUSES, { error: "وضعیت نامعتبر است" }), note }).strict();

export const orderListQuerySchema = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    before: z.string().regex(ID_RE).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
