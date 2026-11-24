import { quoteShipping, type LineProblem, type ShippingMethod, type ShippingOption } from "@store-builder/shared/modules/checkout/checkout";
import type { StorefrontProduct } from "@store-builder/shared/templates/storefront-data";

/**
 * Checkout pricing (phase 3.3, D33-1). Pure: no I/O.
 *
 * Prices come from what the shopper can see: the PUBLISHED product (with live gold/dollar prices already applied by the caller). Stock and
 * the product's current status come from the stock rows (sellable quantity; the stock ledger of 3.2 reads the same). Nothing a page sends
 * is a price. A line that cannot be bought right now stays in the cart with its reason; it counts in no total.
 */

export interface CartLine {
  productId: string;
  variantId: string | null;
  quantity: number;
}

/** Current stock facts, read from the stock rows (null = the row is gone). */
export interface StockFact {
  productActive: boolean;
  /** Sellable quantity of the product (no variants) or of the variant. */
  available: number;
}

export interface PricedLine {
  productId: string;
  variantId: string | null;
  quantity: number;
  name: string;
  slug: string | null;
  /** "رنگ: قرمز، سایز: M" for a variant, else "". */
  variantLabel: string;
  imageKey: string | null;
  unitPrice: number;
  lineTotal: number;
  /** null = can be bought as is. */
  problem: LineProblem | null;
  /** What is left now, when it is less than asked for. */
  available: number | null;
}

export const stockKey = (productId: string, variantId: string | null) => `${productId}|${variantId ?? "-"}`;

export function priceLines(lines: readonly CartLine[], published: readonly StorefrontProduct[], stock: ReadonlyMap<string, StockFact>): PricedLine[] {
  const byId = new Map(published.map((p) => [p.id, p]));
  return lines.map((l) => {
    const p = byId.get(l.productId);
    const base = { productId: l.productId, variantId: l.variantId, quantity: l.quantity };
    if (!p) return { ...base, name: "کالای حذف‌شده", slug: null, variantLabel: "", imageKey: null, unitPrice: 0, lineTotal: 0, problem: "unavailable" as const, available: null };
    const shown = { name: p.name, slug: p.slug, imageKey: p.image?.key ?? null };
    if (p.variants.length > 0 && l.variantId === null) {
      return { ...base, ...shown, variantLabel: "", unitPrice: p.price, lineTotal: 0, problem: "choose_variant" as const, available: null };
    }
    const v = l.variantId === null ? null : p.variants.find((x) => x.id === l.variantId);
    if (l.variantId !== null && !v) return { ...base, ...shown, variantLabel: "", unitPrice: 0, lineTotal: 0, problem: "unavailable" as const, available: null };
    const unitPrice = v ? v.price : p.price;
    const variantLabel = v ? v.options.map((o) => `${o.name}: ${o.value}`).join("، ") : "";
    const fact = stock.get(stockKey(l.productId, l.variantId));
    let problem: LineProblem | null = null;
    let available: number | null = null;
    if (!fact || !fact.productActive) problem = "unavailable";
    else if (fact.available <= 0) problem = "out_of_stock";
    else if (fact.available < l.quantity) {
      problem = "not_enough_stock";
      available = fact.available;
    }
    return { ...base, ...shown, variantLabel, unitPrice, lineTotal: problem ? 0 : unitPrice * l.quantity, problem, available };
  });
}

export interface WeightFacts {
  knownGrams: number;
  unknownWeightUnits: number;
}

/** Shipping weight of the buyable lines: the published product weight per unit (variants share their product's weight). */
export function weightOf(lines: readonly PricedLine[], published: readonly StorefrontProduct[]): WeightFacts {
  const grams = new Map(published.map((p) => [p.id, p.weightGrams]));
  let knownGrams = 0;
  let unknownWeightUnits = 0;
  for (const l of lines) {
    if (l.problem) continue;
    const g = grams.get(l.productId);
    if (g === null || g === undefined) unknownWeightUnits += l.quantity;
    else knownGrams += g * l.quantity;
  }
  return { knownGrams, unknownWeightUnits };
}

export interface CheckoutSummary {
  lines: PricedLine[];
  subtotal: number;
  /** Methods offered for the address's province (empty without an address). */
  shippingOptions: ShippingOption[];
  shippingMethodId: string | null;
  shippingCost: number;
  cashOnDelivery: boolean;
  codFee: number;
  /** Phase 5.1: the applied discount code (items and/or shipping), or null. */
  discount: AppliedDiscount | null;
  /** Phase 5.1: why the code the shopper gave does not apply (then the order cannot be placed with it). */
  discountError: { code: string; reason: string; message: string; minOrder?: number } | null;
  total: number;
  /** Everything needed to place the order is there and valid (phase 3.4 places it). */
  ready: boolean;
  /** Why it is not ready, in the order the shopper should fix them. */
  blockers: CheckoutBlocker[];
}

export type CheckoutBlocker = "empty_cart" | "line_problems" | "no_address" | "no_shipping_for_province" | "choose_shipping" | "shipping_unavailable" | "cod_unavailable" | "discount_invalid";

/** Phase 5.1: a code applied to the summary (the id is for the order's redemption, never sent to the shopper). */
export interface AppliedDiscount {
  id: string;
  code: string;
  amount: number;
  itemsDiscount: number;
  shippingDiscount: number;
}

export const BLOCKER_MESSAGES: Readonly<Record<CheckoutBlocker, string>> = {
  empty_cart: "سبد خرید خالی است.",
  line_problems: "بعضی کالاهای سبد قابل خرید نیستند؛ آن‌ها را اصلاح یا حذف کنید.",
  no_address: "نشانی تحویل را وارد کنید.",
  no_shipping_for_province: "فروشگاه به این استان ارسال ندارد.",
  choose_shipping: "روش ارسال را انتخاب کنید.",
  shipping_unavailable: "روش ارسال انتخاب‌شده برای این نشانی در دسترس نیست.",
  cod_unavailable: "پرداخت در محل برای این روش ارسال و نشانی ممکن نیست.",
  discount_invalid: "کد تخفیف واردشده قابل استفاده نیست؛ آن را اصلاح یا حذف کنید.",
};

export function summarize(o: {
  lines: PricedLine[];
  published: readonly StorefrontProduct[];
  methods: readonly ShippingMethod[];
  province: string | null;
  shippingMethodId: string | null;
  cashOnDelivery: boolean;
}): CheckoutSummary {
  const blockers: CheckoutBlocker[] = [];
  const buyable = o.lines.filter((l) => !l.problem);
  const subtotal = buyable.reduce((s, l) => s + l.lineTotal, 0);
  if (o.lines.length === 0) blockers.push("empty_cart");
  if (o.lines.some((l) => l.problem)) blockers.push("line_problems");

  let shippingOptions: ShippingOption[] = [];
  if (o.province === null) blockers.push("no_address");
  else {
    const w = weightOf(o.lines, o.published);
    shippingOptions = o.methods.flatMap((m) => {
      const q = quoteShipping(m, { province: o.province!, subtotal, ...w });
      return q ? [q] : [];
    });
    if (shippingOptions.length === 0) blockers.push("no_shipping_for_province");
  }

  let chosen: ShippingOption | null = null;
  if (o.shippingMethodId !== null) {
    chosen = shippingOptions.find((s) => s.methodId === o.shippingMethodId) ?? null;
    if (!chosen && o.province !== null) blockers.push("shipping_unavailable");
  } else if (shippingOptions.length > 0) blockers.push("choose_shipping");

  const cod = o.cashOnDelivery && chosen !== null && chosen.cashOnDelivery.available;
  if (o.cashOnDelivery && chosen !== null && !chosen.cashOnDelivery.available) blockers.push("cod_unavailable");
  const shippingCost = chosen?.cost ?? 0;
  const codFee = cod ? chosen!.cashOnDelivery.fee : 0;
  return {
    lines: o.lines,
    subtotal,
    shippingOptions,
    shippingMethodId: chosen?.methodId ?? null,
    shippingCost,
    cashOnDelivery: cod,
    codFee,
    discount: null,
    discountError: null,
    total: subtotal + shippingCost + codFee,
    ready: blockers.length === 0,
    blockers,
  };
}

/**
 * Phase 5.1: the summary with a discount code's result: an applied discount lowers the total (never below zero: the rules cap it at the
 * eligible items plus shipping); a code that does not apply blocks placing the order until the shopper fixes or removes it.
 */
export function withDiscount(s: CheckoutSummary, d: { applied: AppliedDiscount } | { error: { code: string; reason: string; message: string; minOrder?: number } }): CheckoutSummary {
  if ("error" in d) {
    const blockers: CheckoutBlocker[] = [...s.blockers, "discount_invalid"];
    return { ...s, discount: null, discountError: d.error, ready: false, blockers };
  }
  const amount = Math.min(d.applied.amount, s.subtotal + s.shippingCost);
  return { ...s, discount: { ...d.applied, amount }, discountError: null, total: s.subtotal + s.shippingCost + s.codFee - amount };
}

/** Merging a guest cart into a signed-in customer's cart: quantities add up (capped), new lines go after the existing ones (capped). */
export function mergeLines(into: readonly CartLine[], from: readonly CartLine[], maxLines: number, maxQuantity: number): CartLine[] {
  const out = into.map((l) => ({ ...l }));
  const index = new Map(out.map((l, i) => [stockKey(l.productId, l.variantId), i]));
  for (const l of from) {
    const i = index.get(stockKey(l.productId, l.variantId));
    if (i !== undefined) out[i]!.quantity = Math.min(maxQuantity, out[i]!.quantity + l.quantity);
    else if (out.length < maxLines) {
      index.set(stockKey(l.productId, l.variantId), out.length);
      out.push({ ...l, quantity: Math.min(maxQuantity, l.quantity) });
    }
  }
  return out;
}
