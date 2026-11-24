import { z } from "zod";
import { MAX_PRICE_TOMAN } from "../../lib/money.js";
import { normalizeIranMobile } from "../../lib/phone.js";
import { digitsToAscii, normalizeFa } from "../../lib/text.js";
import { isProvinceCode } from "./provinces.js";

/**
 * Checkout rules (phase 3.3, D33-1). Pure: shared by the API (validation, totals) and the storefront (the same numbers on screen).
 * Money is whole toman, integers only. The server always recomputes; nothing a page sends is trusted as a price.
 */

// ---------- limits ----------

/** Distinct lines per cart (the stock hold of 3.4 takes the same number: MAX_RESERVATION_LINES). */
export const MAX_CART_LINES = 50;
/** Units of one line (also a DB CHECK; the stock ledger allows the same). */
export const MAX_CART_LINE_QUANTITY = 1000;
/** A cart nobody touched for this long is deleted by db-cleanup. */
export const CART_TTL_DAYS = 30;
export const MAX_SHIPPING_METHODS = 20;
export const MAX_ADDRESSES_PER_CUSTOMER = 10;
/** Product weight bound (grams, 1 tonne; also a DB CHECK). */
export const MAX_WEIGHT_GRAMS = 1_000_000;

// ---------- text helpers ----------

const clean = (max: number, min: number, label: string) =>
  z
    .string({ error: `${label} را وارد کنید` })
    .transform((v) => normalizeFa(v))
    .pipe(
      z
        .string()
        .min(min, min <= 1 ? `${label} را وارد کنید` : `${label} حداقل ${min} نویسه است`)
        .max(max, `${label} حداکثر ${max} نویسه است`)
        .regex(/^[^\p{Cc}\p{Cs}]*$/u, `${label} نویسه‌ی نامعتبر دارد`),
    );

// ---------- address ----------

/**
 * Iranian postal code: exactly 10 digits (Persian or Arabic digits and spaces/dashes accepted on input). Deliberately lenient beyond
 * the length: a stricter digit rule that rejected one real code would cost a sale. Ten identical digits are refused (obvious filler).
 */
export function normalizePostalCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 30) return null;
  const digits = digitsToAscii(raw).replace(/[\s-]/g, "");
  if (!/^\d{10}$/.test(digits) || /^(\d)\1{9}$/.test(digits)) return null;
  return digits;
}

export const addressInputSchema = z
  .object({
    recipientName: clean(80, 2, "نام گیرنده"),
    phone: z.unknown().transform((v, ctx) => {
      const p = normalizeIranMobile(v);
      if (!p) ctx.addIssue({ code: "custom", message: "شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)" });
      return p ?? "";
    }),
    province: z.unknown().refine(isProvinceCode, "استان را انتخاب کنید").transform((v) => v as string),
    city: clean(40, 2, "شهر"),
    line: clean(250, 10, "نشانی"),
    postalCode: z.unknown().transform((v, ctx) => {
      const p = normalizePostalCode(v);
      if (!p) ctx.addIssue({ code: "custom", message: "کد پستی باید ۱۰ رقم باشد" });
      return p ?? "";
    }),
  })
  .strict();
export type AddressInput = z.output<typeof addressInputSchema>;

// ---------- shipping methods ----------

export const SHIPPING_KINDS = ["FLAT", "WEIGHT", "PICKUP"] as const;
export type ShippingKind = (typeof SHIPPING_KINDS)[number];
export const SHIPPING_KIND_LABELS: Readonly<Record<ShippingKind, string>> = { FLAT: "هزینه‌ی ثابت", WEIGHT: "بر اساس وزن", PICKUP: "تحویل حضوری" };

const toman = z.number().int().min(0).max(MAX_PRICE_TOMAN);
const provinceList = z
  .array(z.unknown().refine(isProvinceCode, "استان نامعتبر است").transform((v) => v as string))
  .max(31)
  .refine((a) => new Set(a).size === a.length, "استان تکراری است");

/**
 * One shipping method as the merchant defines it.
 *  - `provinces`: where it is offered ([] = all of Iran).
 *  - `provincePrices`: a different base price for some provinces (e.g. the store's own province cheaper).
 *  - FLAT: the (province) price. WEIGHT: the (province) price covers the first kilogram, `perKg` each further started kilogram; lines
 *    without a weight count `defaultItemGrams` per unit. PICKUP: always free (the shopper collects; `description` says where).
 *  - `freeAbove`: free when the goods subtotal reaches it (null = never).
 *  - `cashOnDelivery`: pay at the door, optionally only in some provinces and with an extra fee.
 */
export const shippingMethodInputSchema = z
  .object({
    name: clean(60, 1, "نام روش ارسال"),
    kind: z.enum(SHIPPING_KINDS),
    enabled: z.boolean().default(true),
    description: z
      .string()
      .transform((v) => normalizeFa(v))
      .pipe(z.string().max(200, "توضیح حداکثر ۲۰۰ نویسه است").regex(/^[^\p{Cc}\p{Cs}]*$/u, "توضیح نویسه‌ی نامعتبر دارد"))
      .default(""),
    price: toman.default(0),
    perKg: toman.default(0),
    defaultItemGrams: z.number().int().min(0).max(MAX_WEIGHT_GRAMS).default(500),
    provinces: provinceList.default([]),
    provincePrices: z
      .array(z.object({ province: z.unknown().refine(isProvinceCode, "استان نامعتبر است").transform((v) => v as string), price: toman }).strict())
      .max(31)
      .refine((a) => new Set(a.map((p) => p.province)).size === a.length, "قیمت هر استان یک بار")
      .default([]),
    freeAbove: toman.nullable().default(null),
    cashOnDelivery: z
      .object({ enabled: z.boolean(), provinces: provinceList.default([]), fee: toman.default(0) })
      .strict()
      .default({ enabled: false, provinces: [], fee: 0 }),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.kind === "PICKUP" && (m.price !== 0 || m.perKg !== 0 || m.provincePrices.length > 0)) {
      ctx.addIssue({ code: "custom", path: ["price"], message: "تحویل حضوری هزینه‌ی ارسال ندارد" });
    }
    if (m.kind !== "WEIGHT" && m.perKg !== 0) ctx.addIssue({ code: "custom", path: ["perKg"], message: "هزینه‌ی هر کیلو فقط برای ارسال وزنی است" });
    if (m.provinces.length > 0 && m.provincePrices.some((p) => !m.provinces.includes(p.province))) {
      ctx.addIssue({ code: "custom", path: ["provincePrices"], message: "برای استانی قیمت گذاشته‌اید که این روش در آن ارسال نمی‌کند" });
    }
  });
export type ShippingMethodInput = z.output<typeof shippingMethodInputSchema>;

export const replaceShippingMethodsSchema = z
  .object({ methods: z.array(shippingMethodInputSchema).max(MAX_SHIPPING_METHODS, `حداکثر ${MAX_SHIPPING_METHODS} روش ارسال`) })
  .strict();

/** A stored method (the input plus its id). */
export interface ShippingMethod extends ShippingMethodInput {
  id: string;
}

export interface ShippingContext {
  province: string;
  /** Goods subtotal in toman (after current prices). */
  subtotal: number;
  /** Units without a known weight are counted with each method's `defaultItemGrams`. */
  knownGrams: number;
  unknownWeightUnits: number;
}

export interface ShippingOption {
  methodId: string;
  name: string;
  kind: ShippingKind;
  description: string;
  cost: number;
  /** The goods subtotal reached `freeAbove` (the cost is 0 because of it). */
  freeByThreshold: boolean;
  cashOnDelivery: { available: boolean; fee: number };
}

/** What `method` costs for this cart and address, or null when it is not offered there. Pure, integer-only. */
export function quoteShipping(method: ShippingMethod, c: ShippingContext): ShippingOption | null {
  if (!method.enabled) return null;
  if (method.provinces.length > 0 && !method.provinces.includes(c.province)) return null;
  const base = method.provincePrices.find((p) => p.province === c.province)?.price ?? method.price;
  let cost = 0;
  if (method.kind === "FLAT") cost = base;
  else if (method.kind === "WEIGHT") {
    const grams = c.knownGrams + c.unknownWeightUnits * method.defaultItemGrams;
    const extraKg = Math.max(0, Math.ceil(grams / 1000) - 1);
    // Capped at MAX_PRICE_TOMAN without ever forming a product beyond it (review 3.3: extreme weights x perKg lost integer precision).
    const room = MAX_PRICE_TOMAN - base;
    cost = method.perKg > 0 && extraKg > Math.floor(room / method.perKg) ? MAX_PRICE_TOMAN : base + extraKg * method.perKg;
  }
  const freeByThreshold = method.freeAbove !== null && c.subtotal >= method.freeAbove && cost > 0;
  if (freeByThreshold) cost = 0;
  const cod = method.cashOnDelivery;
  const codAvailable = cod.enabled && (cod.provinces.length === 0 || cod.provinces.includes(c.province));
  return {
    methodId: method.id,
    name: method.name,
    kind: method.kind,
    description: method.description,
    cost,
    freeByThreshold,
    cashOnDelivery: { available: codAvailable, fee: codAvailable ? cod.fee : 0 },
  };
}

// ---------- cart ----------

const ID_RE = /^[a-z0-9]{1,64}$/;
const id = z.string().regex(ID_RE, "شناسه نامعتبر است");

/** Add to cart / set quantity. `quantity: 0` in a set removes the line. */
export const cartLineInputSchema = z
  .object({
    productId: id,
    variantId: id.nullable().default(null),
    quantity: z.number().int().min(0).max(MAX_CART_LINE_QUANTITY, `حداکثر ${MAX_CART_LINE_QUANTITY} عدد از هر کالا`),
  })
  .strict();
export type CartLineInput = z.output<typeof cartLineInputSchema>;

/** Why a cart line cannot be bought right now (the line stays in the cart; the shopper decides). */
export const LINE_PROBLEMS = ["unavailable", "choose_variant", "out_of_stock", "not_enough_stock"] as const;
export type LineProblem = (typeof LINE_PROBLEMS)[number];
export const LINE_PROBLEM_MESSAGES: Readonly<Record<LineProblem, string>> = {
  unavailable: "این کالا دیگر فروخته نمی‌شود.",
  choose_variant: "این کالا چند نوع دارد؛ نوع آن را انتخاب کنید.",
  out_of_stock: "این کالا ناموجود است.",
  not_enough_stock: "موجودی این کالا کمتر از تعداد انتخاب‌شده است.",
};

export const checkoutQuoteSchema = z
  .object({
    address: z.unknown().optional(),
    addressId: id.optional(),
    shippingMethodId: id.optional(),
    cashOnDelivery: z.boolean().default(false),
    /** Phase 5.1: one discount code (case-insensitive). */
    discountCode: z.string().max(64).optional(),
  })
  .strict();
