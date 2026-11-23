import { z } from "zod";
import { MAX_PRICE_TOMAN } from "../../lib/money.js";

/**
 * Prices linked to the dollar or to gold (phase 3.2b, D32b-1). Pure and integer-only (BigInt in the middle): no floating point ever touches
 * a price. Shared by the API (validation, repricing) and the dashboard/storefront (display).
 */

export const RATE_CODES = ["USD", "GOLD18"] as const;
export type RateCode = (typeof RATE_CODES)[number];
export const RATE_LABEL_FA: Record<RateCode, string> = { USD: "دلار (بازار آزاد، فروش)", GOLD18: "طلای ۱۸ عیار (هر گرم)" };

/** Plausible toman values; anything outside is a broken feed or a wrong unit, never applied. */
export const RATE_SANITY: Record<RateCode, { min: number; max: number }> = {
  USD: { min: 10_000, max: 10_000_000 },
  GOLD18: { min: 100_000, max: 1_000_000_000 },
};

export const ROUNDING_STEPS = [1, 100, 1_000, 10_000] as const;
export const MAX_WEIGHT_MG = 10_000_000; // 10 kg
const BP = 10_000n; // basis points: 900 = 9%

const toman = z.number().int().min(1).max(MAX_PRICE_TOMAN);
const bp = (max: number) => z.number().int().min(0).max(max);
const rounding = z.union(ROUNDING_STEPS.map((n) => z.literal(n)) as unknown as [z.ZodLiteral<1>, z.ZodLiteral<100>, z.ZodLiteral<1000>, z.ZodLiteral<10000>]).default(1_000);

/**
 * What the merchant sends. Dollar: today's toman price (`fromToman`, converted at the current rate) or a dollar amount in cents.
 * Gold: the jewellery formula (weight, labour, profit, tax, stones), or `fromToman` for a plain link (the equivalent weight, no labour).
 */
export const priceLinkInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("USD"),
      fromToman: toman.optional(),
      usdCents: z.number().int().min(1).max(100_000_000).optional(),
      roundingToman: rounding,
    })
    .strict()
    .refine((v) => (v.fromToman === undefined) !== (v.usdCents === undefined), { message: "یا قیمت امروز به تومان یا مبلغ دلاری را وارد کنید", path: ["fromToman"] }),
  z
    .object({
      kind: z.literal("GOLD"),
      fromToman: toman.optional(),
      weightMg: z.number().int().min(1).max(MAX_WEIGHT_MG).optional(),
      wageBp: bp(10_000).default(0),
      profitBp: bp(10_000).default(0),
      taxBp: bp(3_000).default(900),
      stoneToman: z.number().int().min(0).max(MAX_PRICE_TOMAN).default(0),
      roundingToman: rounding,
    })
    .strict()
    .refine((v) => (v.fromToman === undefined) !== (v.weightMg === undefined), { message: "یا قیمت امروز به تومان یا وزن طلا را وارد کنید", path: ["weightMg"] })
    .refine((v) => v.fromToman === undefined || (v.wageBp === 0 && v.profitBp === 0 && v.stoneToman === 0), {
      message: "با قیمت تومانی، اجرت و سود و سنگ وارد نکنید (برای آن‌ها وزن را وارد کنید)",
      path: ["fromToman"],
    }),
]);
export type PriceLinkInput = z.output<typeof priceLinkInputSchema>;

/** A stored link: what the formula needs. */
export type PriceLink =
  | { kind: "USD"; usdCents: number; roundingToman: number }
  | { kind: "GOLD"; weightMg: number; wageBp: number; profitBp: number; taxBp: number; stoneToman: number; roundingToman: number };

export const codeOf = (link: { kind: "USD" | "GOLD" }): RateCode => (link.kind === "USD" ? "USD" : "GOLD18");

/** Half-up integer division of non-negative BigInts. */
const div = (a: bigint, b: bigint) => (a * 2n + b) / (2n * b);

/** Turns the merchant's input into a stored link at the current rate (toman inputs are converted once, here). */
export function linkFromInput(input: PriceLinkInput, rateToman: number): PriceLink | null {
  if (input.kind === "USD") {
    const usdCents = input.usdCents ?? Number(div(BigInt(input.fromToman!) * 100n, BigInt(rateToman)));
    return usdCents >= 1 ? { kind: "USD", usdCents, roundingToman: input.roundingToman } : null;
  }
  // grams = toman / (rate per gram); stored in milligrams
  const weightMg = input.weightMg ?? Number(div(BigInt(input.fromToman!) * 1000n, BigInt(rateToman)));
  if (weightMg < 1 || weightMg > MAX_WEIGHT_MG) return null;
  return input.fromToman !== undefined
    ? { kind: "GOLD", weightMg, wageBp: 0, profitBp: 0, taxBp: 0, stoneToman: 0, roundingToman: input.roundingToman }
    : { kind: "GOLD", weightMg, wageBp: input.wageBp, profitBp: input.profitBp, taxBp: input.taxBp, stoneToman: input.stoneToman, roundingToman: input.roundingToman };
}

export type PriceResult = { ok: true; priceToman: number } | { ok: false; reason: "out_of_range" };

/**
 * The toman price for a link at a rate.
 *  - Dollar: cents x rate / 100.
 *  - Gold (Iranian gold-market formula): gold = weight x gram rate; labour = gold x wage%; profit = (gold + labour) x profit%;
 *    tax = (labour + profit) x tax%; price = gold + labour + profit + tax + stones.
 * Rounded to the link's step (half up). A result above MAX_PRICE_TOMAN (or zero) is refused: the caller keeps the last price.
 */
export function priceOf(link: PriceLink, rateToman: number): PriceResult {
  const rate = BigInt(rateToman);
  let raw: bigint;
  if (link.kind === "USD") raw = div(BigInt(link.usdCents) * rate, 100n);
  else {
    const gold = div(BigInt(link.weightMg) * rate, 1000n);
    const labour = div(gold * BigInt(link.wageBp), BP);
    const profit = div((gold + labour) * BigInt(link.profitBp), BP);
    const tax = div((labour + profit) * BigInt(link.taxBp), BP);
    raw = gold + labour + profit + tax + BigInt(link.stoneToman);
  }
  const step = BigInt(link.roundingToman);
  const rounded = div(raw, step) * step;
  if (rounded < 1n || rounded > BigInt(MAX_PRICE_TOMAN)) return { ok: false, reason: "out_of_range" };
  return { ok: true, priceToman: Number(rounded) };
}

export type RateDecision = "apply" | "hold" | "reject";

/**
 * What to do with a freshly fetched rate: outside the sanity band -> reject (never stored as applicable); a move larger than
 * `jumpPercent` against the last applied rate -> hold for a super admin's confirmation; otherwise apply.
 * `dayReference` (the rate that was current 24 hours earlier) bounds a slow drift: small steps that add up to more than twice the
 * threshold within a day are held too (security review 3.2b: a forged feed could otherwise walk prices down hour by hour).
 */
export function decideRate(
  code: RateCode,
  next: number,
  lastApplied: number | null,
  jumpPercent: number,
  dayReference: number | null = null,
  /** The last rate a PERSON entered or confirmed: automatic readings never drift more than 3x the threshold away from it unconfirmed. */
  humanReference: number | null = null,
): RateDecision {
  const band = RATE_SANITY[code];
  if (!Number.isInteger(next) || next < band.min || next > band.max) return "reject";
  if (lastApplied === null) return "hold"; // the very first automatic rate is confirmed by a person
  const moved = (from: number, pct: number) => Math.abs(next - from) * 100 > from * pct;
  if (moved(lastApplied, jumpPercent)) return "hold";
  if (dayReference !== null && moved(dayReference, jumpPercent * 2)) return "hold";
  if (humanReference !== null && moved(humanReference, jumpPercent * 3)) return "hold";
  return "apply";
}

export const isStale = (appliedAt: Date | null, now: Date, maxAgeHours: number) => appliedAt === null || now.getTime() - appliedAt.getTime() > maxAgeHours * 3_600_000;

/** Parses a provider number ("1,234,567" or "1234567.0"), converting rial to toman; null when it is not a clean positive number. */
export function parseProviderNumber(raw: unknown, unit: "toman" | "rial"): number | null {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.replace(/[,\s]/g, "") : "";
  if (!/^\d{1,13}(\.\d{1,4})?$/.test(s)) return null;
  const n = Math.round(Number(s));
  const v = unit === "rial" ? Math.round(n / 10) : n;
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}
