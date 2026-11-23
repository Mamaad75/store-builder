import { codeOf, priceOf, type PriceLink, type RateCode } from "@store-builder/shared/modules/pricing/pricing";

/**
 * Repricing rules (phase 3.2b, D32b-1). Pure. The shared module holds the formula; this file decides what a repricing run writes.
 */

/** "-" is the product itself (or the lowest-variant summary); otherwise the variant id. */
export const PRODUCT_TARGET = "-";
export const targetOf = (variantId: string | null) => variantId ?? PRODUCT_TARGET;

export type CurrentRates = Partial<Record<RateCode, { rateToman: number; appliedAt: Date }>>;

export interface StoredLink {
  productId: string;
  variantId: string | null;
  link: PriceLink;
}

export type LinkOutcome =
  | { productId: string; variantId: string | null; result: "priced"; priceToman: number; rateAt: Date }
  | { productId: string; variantId: string | null; result: "out_of_range" }
  | { productId: string; variantId: string | null; result: "no_rate" };

/** The new price of every link at the current rates. A missing rate leaves that link alone; an out-of-range result keeps the last price. */
export function repriceLinks(links: readonly StoredLink[], rates: CurrentRates): LinkOutcome[] {
  return links.map(({ productId, variantId, link }) => {
    const rate = rates[codeOf(link)];
    if (!rate) return { productId, variantId, result: "no_rate" };
    const r = priceOf(link, rate.rateToman);
    return r.ok ? { productId, variantId, result: "priced", priceToman: r.priceToman, rateAt: rate.appliedAt } : { productId, variantId, result: "out_of_range" };
  });
}

/** A product with variants shows its lowest variant price (D32-1); null when it has none. */
export function lowestPrice(prices: readonly number[]): number | null {
  return prices.length ? Math.min(...prices) : null;
}

/** Plain, typed problems the service turns into validation messages. */
export type LinkProblem = "no_rate" | "variant_required" | "variant_not_allowed" | "unknown_variant" | "out_of_range" | "bad_conversion";

export const LINK_PROBLEM_FA: Record<LinkProblem, string> = {
  no_rate: "نرخ این مبنا هنوز ثبت نشده است؛ بعد از ثبت نرخ توسط مدیر پلتفرم دوباره تلاش کنید.",
  variant_required: "این محصول تنوع دارد؛ قیمت هر تنوع را جداگانه متصل کنید.",
  variant_not_allowed: "این محصول تنوع ندارد؛ تنوعی انتخاب نکنید.",
  unknown_variant: "این تنوع در این محصول نیست.",
  out_of_range: "قیمت حساب‌شده خارج از محدوده‌ی مجاز است.",
  bad_conversion: "با این نرخ، مقدار واردشده قابل تبدیل نیست.",
};
