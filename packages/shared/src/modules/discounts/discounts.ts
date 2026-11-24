import { z } from "zod";
import { digitsToAscii, normalizeFaText } from "../../lib/text.js";

/**
 * Discount codes (phase 5.1, D51-1). Pure: shared by the API (rules, pricing) and the dashboard/storefront (forms, messages).
 *
 * Owner decisions (2026-11-24): percentage (with an optional maximum), fixed amount and free shipping; start/end dates, a minimum order,
 * a total usage limit and a per-customer limit (by phone), only for chosen products or categories, first order only; ONE code per order.
 * Money is toman. A discount never makes an amount negative: it applies to the eligible lines' total (and the shipping cost for free
 * shipping) at most.
 */

export const DISCOUNT_TYPES = ["PERCENT", "FIXED", "FREE_SHIPPING"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];
export const DISCOUNT_TYPE_LABELS: Readonly<Record<DiscountType, string>> = { PERCENT: "درصدی", FIXED: "مبلغ ثابت", FREE_SHIPPING: "ارسال رایگان" };

export const DISCOUNT_SCOPES = ["ALL", "PRODUCTS", "CATEGORIES"] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

export const MAX_DISCOUNTS_PER_STORE = 200;
export const MAX_SCOPE_IDS = 200;
/** Wrong codes tried per network per store per hour (codes must not be guessable by trying). */
export const DISCOUNT_TRY_RULE = { limit: 30, windowSeconds: 3600 } as const;

/** Codes are case-insensitive: stored and compared in upper case; Persian digits accepted. */
export const normalizeCode = (v: string) => digitsToAscii(v).trim().toUpperCase();
export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export interface DiscountRule {
  id: string;
  code: string;
  type: DiscountType;
  /** PERCENT: 1..100; FIXED: toman; FREE_SHIPPING: 0. */
  value: number;
  /** PERCENT only: the largest discount in toman (null = none). */
  maxDiscount: number | null;
  minOrder: number | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  scope: DiscountScope;
  scopeIds: string[];
  active: boolean;
}

/** What the discount is computed on: the buyable lines (with their product's category) and the chosen shipping cost. */
export interface DiscountCart {
  lines: { productId: string; categoryId: string | null; lineTotal: number }[];
  subtotal: number;
  shippingCost: number;
}

/** Usage facts (from the redemptions; for the per-customer and first-order rules, null = not known yet: no phone so far). */
export interface DiscountUsage {
  total: number;
  byCustomer: number | null;
  hasPriorOrders: boolean | null;
}

export const DISCOUNT_REASONS = ["not_found", "changed", "inactive", "not_started", "expired", "min_order", "exhausted", "customer_limit", "first_order_only", "no_eligible_items", "no_shipping"] as const;
export type DiscountReason = (typeof DISCOUNT_REASONS)[number];
export const DISCOUNT_REASON_MESSAGES: Readonly<Record<DiscountReason, string>> = {
  not_found: "این کد تخفیف معتبر نیست.",
  changed: "شرایط این کد تخفیف همین حالا تغییر کرد؛ صفحه را دوباره بررسی کنید.",
  inactive: "این کد تخفیف فعال نیست.",
  not_started: "زمان استفاده از این کد تخفیف هنوز نرسیده است.",
  expired: "مهلت استفاده از این کد تخفیف تمام شده است.",
  min_order: "مبلغ سفارش برای این کد تخفیف کافی نیست.",
  exhausted: "ظرفیت استفاده از این کد تخفیف تمام شده است.",
  customer_limit: "شما قبلاً از این کد تخفیف استفاده کرده‌اید.",
  first_order_only: "این کد تخفیف فقط برای اولین خرید از این فروشگاه است.",
  no_eligible_items: "این کد تخفیف برای کالاهای سبد شما نیست.",
  no_shipping: "این کد ارسال رایگان است؛ ابتدا روش ارسال را انتخاب کنید.",
};

export type DiscountResult =
  | { ok: true; itemsDiscount: number; shippingDiscount: number; amount: number }
  | { ok: false; reason: DiscountReason; minOrder?: number };

/** The discount of one code on one cart; no side effects. */
export function evaluateDiscount(r: DiscountRule, cart: DiscountCart, usage: DiscountUsage, now: Date): DiscountResult {
  if (!r.active) return { ok: false, reason: "inactive" };
  if (r.startsAt && now < new Date(r.startsAt)) return { ok: false, reason: "not_started" };
  if (r.endsAt && now >= new Date(r.endsAt)) return { ok: false, reason: "expired" };
  if (r.usageLimit !== null && usage.total >= r.usageLimit) return { ok: false, reason: "exhausted" };
  if (r.perCustomerLimit !== null && usage.byCustomer !== null && usage.byCustomer >= r.perCustomerLimit) return { ok: false, reason: "customer_limit" };
  if (r.firstOrderOnly && usage.hasPriorOrders === true) return { ok: false, reason: "first_order_only" };
  if (r.minOrder !== null && cart.subtotal < r.minOrder) return { ok: false, reason: "min_order", minOrder: r.minOrder };
  const ids = new Set(r.scopeIds);
  const eligible = cart.lines.filter((l) => r.scope === "ALL" || (r.scope === "PRODUCTS" ? ids.has(l.productId) : l.categoryId !== null && ids.has(l.categoryId)));
  if (eligible.length === 0) return { ok: false, reason: "no_eligible_items" };
  const base = eligible.reduce((s, l) => s + l.lineTotal, 0);
  if (r.type === "FREE_SHIPPING") return { ok: true, itemsDiscount: 0, shippingDiscount: cart.shippingCost, amount: cart.shippingCost };
  let items = r.type === "PERCENT" ? Math.floor((base * r.value) / 100) : r.value;
  if (r.type === "PERCENT" && r.maxDiscount !== null) items = Math.min(items, r.maxDiscount);
  items = Math.max(0, Math.min(items, base));
  return { ok: true, itemsDiscount: items, shippingDiscount: 0, amount: items };
}

const toman = (max: number, msg: string) =>
  z.preprocess((v) => (typeof v === "string" ? Number(digitsToAscii(v).replace(/[,،\s]/g, "")) : v), z.number({ error: msg }).int(msg).min(0, msg).max(max, msg));
const optionalToman = (max: number, msg: string) => z.union([z.null(), z.literal(""), toman(max, msg)]).optional().transform((v) => (v === "" || v === undefined ? null : v));
const optionalCount = (msg: string) =>
  z.union([z.null(), z.literal(""), z.preprocess((v) => (typeof v === "string" ? Number(digitsToAscii(v)) : v), z.number().int(msg).min(1, msg).max(1_000_000, msg))]).optional().transform((v) => (v === "" || v === undefined ? null : v));
const optionalDate = z
  .union([z.null(), z.literal(""), z.string().datetime({ offset: true, error: "تاریخ نامعتبر است" })])
  .optional()
  .transform((v) => (v ? new Date(v).toISOString() : null));

/** A discount code as the merchant creates or edits it. */
export const discountInputSchema = z
  .object({
    code: z.string({ error: "کد را وارد کنید" }).transform(normalizeCode).pipe(z.string().regex(CODE_RE, "کد: ۳ تا ۳۲ حرف انگلیسی، عدد، - یا _")),
    title: z.string().optional().default("").transform(normalizeFaText).pipe(z.string().max(80, "عنوان حداکثر ۸۰ نویسه")),
    type: z.enum(DISCOUNT_TYPES, { error: "نوع تخفیف را انتخاب کنید" }),
    value: z.preprocess((v) => (typeof v === "string" ? Number(digitsToAscii(v).replace(/[,،\s]/g, "")) : v ?? 0), z.number({ error: "مقدار تخفیف را وارد کنید" }).int("مقدار تخفیف عدد صحیح است").min(0)),
    maxDiscount: optionalToman(1_000_000_000, "سقف تخفیف نامعتبر است"),
    minOrder: optionalToman(1_000_000_000, "حداقل مبلغ سفارش نامعتبر است"),
    startsAt: optionalDate,
    endsAt: optionalDate,
    usageLimit: optionalCount("سقف کل استفاده نامعتبر است"),
    perCustomerLimit: optionalCount("سقف استفاده‌ی هر مشتری نامعتبر است"),
    firstOrderOnly: z.boolean().optional().default(false),
    scope: z.enum(DISCOUNT_SCOPES).optional().default("ALL"),
    scopeIds: z.array(z.string().regex(/^[a-z0-9]{1,64}$/)).max(MAX_SCOPE_IDS, `حداکثر ${MAX_SCOPE_IDS} مورد`).optional().default([]),
    active: z.boolean().optional().default(true),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.type === "PERCENT" && (d.value < 1 || d.value > 100)) ctx.addIssue({ code: "custom", path: ["value"], message: "درصد تخفیف بین ۱ و ۱۰۰ است" });
    if (d.type === "FIXED" && (d.value < 1_000 || d.value > 1_000_000_000)) ctx.addIssue({ code: "custom", path: ["value"], message: "مبلغ تخفیف دست‌کم ۱٬۰۰۰ تومان است" });
    if (d.type !== "PERCENT" && d.maxDiscount !== null) ctx.addIssue({ code: "custom", path: ["maxDiscount"], message: "سقف تخفیف فقط برای تخفیف درصدی است" });
    if (d.startsAt && d.endsAt && d.endsAt <= d.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "پایان باید بعد از شروع باشد" });
    if (d.scope === "ALL" && d.scopeIds.length) ctx.addIssue({ code: "custom", path: ["scopeIds"], message: "برای همه‌ی کالاها فهرست لازم نیست" });
    if (d.scope !== "ALL" && d.scopeIds.length === 0) ctx.addIssue({ code: "custom", path: ["scopeIds"], message: "دست‌کم یک کالا یا دسته را انتخاب کنید" });
  })
  .transform((d) => ({ ...d, value: d.type === "FREE_SHIPPING" ? 0 : d.value, scopeIds: [...new Set(d.scopeIds)] }));
export type DiscountInput = z.output<typeof discountInputSchema>;

/** The code a shopper types at checkout (normalised; anything else is simply "not found"). */
export const shopperCodeSchema = z.string().max(64).transform(normalizeCode);
