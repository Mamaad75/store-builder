import { z } from "zod";
import { IRAN_MOBILE_E164, normalizeIranMobile } from "../../lib/phone.js";

/**
 * Order SMS (phase 3.6, D36-1). Pure: shared by the API/worker (rules) and the dashboards (labels, forms).
 *
 * Owner decisions (2026-11-24): the shopper gets an SMS when the order is placed (or paid), shipped, cancelled or expired, and when a
 * card-to-card receipt is rejected; the merchant gets one for each new order and each receipt waiting for review. The platform's Kavenegar
 * account sends them (the platform pays); each store has a monthly cap, and each merchant can turn order SMS off for their store.
 * Messages are Kavenegar verify/lookup TEMPLATES approved in the platform's panel (one template per kind; an empty name = that SMS is off).
 */

export const ORDER_SMS_KINDS = [
  "SHOPPER_PLACED",
  "SHOPPER_SHIPPED",
  "SHOPPER_CANCELLED",
  "SHOPPER_EXPIRED",
  "SHOPPER_RECEIPT_REJECTED",
  "MERCHANT_NEW_ORDER",
  "MERCHANT_RECEIPT",
] as const;
export type OrderSmsKind = (typeof ORDER_SMS_KINDS)[number];

export const ORDER_SMS_LABELS: Readonly<Record<OrderSmsKind, string>> = {
  SHOPPER_PLACED: "به خریدار: سفارش ثبت شد (یا پرداخت شد)",
  SHOPPER_SHIPPED: "به خریدار: سفارش ارسال شد",
  SHOPPER_CANCELLED: "به خریدار: سفارش لغو شد",
  SHOPPER_EXPIRED: "به خریدار: سفارش پرداخت نشد و منقضی شد",
  SHOPPER_RECEIPT_REJECTED: "به خریدار: رسید کارت به کارت رد شد",
  MERCHANT_NEW_ORDER: "به فروشنده: سفارش تازه",
  MERCHANT_RECEIPT: "به فروشنده: رسید کارت به کارت در انتظار بررسی",
};

/**
 * What each template receives (Kavenegar lookup tokens). token, token2, token3: no spaces; token10: at most 5 spaces; token20: at most 8.
 * The platform operator writes the templates in the Kavenegar panel with these placeholders.
 */
export const ORDER_SMS_TOKENS: Readonly<Record<OrderSmsKind, string>> = {
  SHOPPER_PLACED: "%token% = شماره‌ی سفارش، %token2% = لینک پیگیری، %token10% = نام فروشگاه",
  SHOPPER_SHIPPED: "%token% = شماره‌ی سفارش، %token2% = لینک پیگیری، %token10% = نام فروشگاه",
  SHOPPER_CANCELLED: "%token% = شماره‌ی سفارش، %token2% = لینک پیگیری، %token10% = نام فروشگاه",
  SHOPPER_EXPIRED: "%token% = شماره‌ی سفارش، %token2% = لینک پیگیری، %token10% = نام فروشگاه",
  SHOPPER_RECEIPT_REJECTED: "%token% = شماره‌ی سفارش، %token2% = لینک پیگیری، %token10% = نام فروشگاه",
  MERCHANT_NEW_ORDER: "%token% = شماره‌ی سفارش، %token2% = مبلغ (تومان)، %token10% = نام فروشگاه",
  MERCHANT_RECEIPT: "%token% = شماره‌ی سفارش، %token2% = مبلغ (تومان)، %token10% = نام فروشگاه",
};

export const isMerchantKind = (k: OrderSmsKind) => k.startsWith("MERCHANT_");

/** Review 3.6: SMS one phone may receive from the platform in 24 hours, across all stores (guest phones are not verified). */
export const SMS_PER_PHONE_PER_DAY = 6;
/** Kavenegar lookup token length: a longer token (e.g. a long order link) is never cut: the SMS is skipped instead. */
export const MAX_TOKEN_LENGTH = 100;

/**
 * Review 3.6: what the store name may carry into an SMS sent from the platform's line: no links, domains, e-mail addresses or digits
 * (phone numbers, card numbers) — a merchant must not be able to put "call 0912..." or "go to evil.ir" in the platform's mouth.
 */
export function smsStoreName(name: string): string {
  const cleaned = name
    .replace(/https?:\/\/\S*/gi, " ")
    .replace(/\S*@\S*/g, " ")
    .replace(/\S+\.(ir|com|net|org|io|me|co|info|xyz|app|shop|site|online|store)\b\S*/gi, " ")
    .replace(/[0-9۰-۹٠-٩]/g, " ")
    .replace(/[:/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .trim();
  return cleaned || "فروشگاه";
}

/**
 * Review 3.6: whether a message still fits the order when it is sent (events are delivered unordered and retried with back-off): no
 * "placed" for an order already cancelled or expired, no "shipped" before shipping, no receipt message once the order left payment.
 */
export function stillRelevant(k: OrderSmsKind, status: string): boolean {
  switch (k) {
    case "SHOPPER_PLACED":
    case "MERCHANT_NEW_ORDER":
      return status !== "CANCELLED" && status !== "EXPIRED" && status !== "AWAITING_PAYMENT";
    case "SHOPPER_SHIPPED":
      return status === "SHIPPED" || status === "DELIVERED";
    case "SHOPPER_CANCELLED":
      return status === "CANCELLED";
    case "SHOPPER_EXPIRED":
      return status === "EXPIRED";
    case "SHOPPER_RECEIPT_REJECTED":
    case "MERCHANT_RECEIPT":
      return status === "AWAITING_PAYMENT";
  }
}

/** The SMS kinds a domain event leads to (the worker consumes these events; delivery is at-least-once, so sends are keyed by event + kind). */
export function kindsForEvent(type: string, payload: unknown): OrderSmsKind[] {
  const p = (payload && typeof payload === "object" ? payload : {}) as { to?: unknown; actor?: unknown; source?: unknown };
  switch (type) {
    case "order.placed":
      // A card-to-card order is placed by the merchant's own approval: no "new order" SMS to the merchant for it.
      return p.source === "receipt_approval" ? ["SHOPPER_PLACED"] : ["SHOPPER_PLACED", "MERCHANT_NEW_ORDER"];
    case "order.status_changed":
      if (p.to === "SHIPPED") return ["SHOPPER_SHIPPED"];
      if (p.to === "EXPIRED") return ["SHOPPER_EXPIRED"];
      // A shopper who cancelled their own order needs no SMS about it.
      if (p.to === "CANCELLED" && p.actor !== "CUSTOMER") return ["SHOPPER_CANCELLED"];
      return [];
    case "order.receipt_submitted":
      return ["MERCHANT_RECEIPT"];
    case "order.receipt_rejected":
      return ["SHOPPER_RECEIPT_REJECTED"];
    default:
      return [];
  }
}

/** A token without spaces (token, token2, token3): spaces become underscores; at most 100 characters. */
export const plainToken = (v: string) => v.trim().replace(/\s+/g, "_").slice(0, 100);
/** token10 allows at most 5 spaces: words beyond them are joined with "_"; at most 100 characters. */
export function spacedToken(v: string, maxSpaces = 5): string {
  const words = v.trim().split(/\s+/).filter(Boolean);
  const head = words.slice(0, maxSpaces + 1); // n spaces separate n + 1 words
  const tail = words.slice(maxSpaces + 1);
  if (tail.length) head[head.length - 1] = [head[head.length - 1], ...tail].join("_");
  return head.join(" ").slice(0, 100);
}

/** Kavenegar template names: letters, digits, - and _. Empty = that SMS kind is off. */
const templateName = z.string().trim().max(64).regex(/^[A-Za-z0-9_-]*$/, "فقط حروف انگلیسی، عدد، - و _");

/** The platform's order-SMS part of the "sms" settings group (older stored values lack it: everything off). */
export const orderSmsPlatformSchema = z
  .object({
    /** Master switch for every store. */
    enabled: z.boolean().default(false),
    /**
     * SMS of one store per calendar month (UTC), counted separately for shoppers and for the merchant (review 3.6: fake orders that fill
     * the shoppers' quota never silence the merchant's own new-order SMS).
     */
    monthlyCapPerStore: z.number().int().min(0).max(100_000).default(500),
    templates: z
      .object(Object.fromEntries(ORDER_SMS_KINDS.map((k) => [k, templateName.default("")])) as Record<OrderSmsKind, z.ZodDefault<typeof templateName>>)
      .strict()
      .default(Object.fromEntries(ORDER_SMS_KINDS.map((k) => [k, ""])) as Record<OrderSmsKind, string>),
  })
  .strict();
export type OrderSmsPlatform = z.output<typeof orderSmsPlatformSchema>;

/** A store's own choice: order SMS on or off, and the merchant's mobile for the merchant SMS. */
export const storeSmsSettingsSchema = z
  .object({
    enabled: z.boolean(),
    merchantPhone: z
      .union([z.literal(""), z.string()])
      .transform((v, ctx) => {
        if (v.trim() === "") return null;
        const n = normalizeIranMobile(v);
        if (!n || !IRAN_MOBILE_E164.test(n)) {
          ctx.addIssue({ code: "custom", message: "شماره‌ی موبایل ایران را درست وارد کنید (مثلاً ۰۹۱۲۱۲۳۴۵۶۷)" });
          return z.NEVER;
        }
        return n;
      }),
  })
  .strict();
