import { priceLinkInputSchema, linkFromInput, priceOf, ROUNDING_STEPS, type PriceLinkInput } from "@store-builder/shared/modules/pricing/pricing";
import type { CurrentRates, PriceLinkView } from "@/client/api";

/**
 * The price-link form's maths, pure so it is tested without a browser: typed text -> the integer input the API wants (no floating point
 * ever touches a price), and the price a link gives at today's rate (the same shared formula the API reprices with).
 */
export type LinkKind = "USD" | "GOLD";
export interface LinkForm {
  kind: LinkKind;
  /** "toman" = type today's price and let the system work out the equivalent; "native" = type the dollar amount or the gold formula. */
  basis: "toman" | "native";
  toman: string;
  usd: string;
  grams: string;
  wage: string;
  profit: string;
  tax: string;
  stone: string;
  rounding: number;
}
export const EMPTY_LINK_FORM: LinkForm = { kind: "USD", basis: "toman", toman: "", usd: "", grams: "", wage: "0", profit: "0", tax: "9", stone: "0", rounding: 1000 };

const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";
/** Persian and Arabic digits to ASCII, "٫" to ".", thousands separators removed. */
export function asciiNumber(s: string): string {
  return s
    .trim()
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)))
    .replace(/[٫]/g, ".")
    .replace(/[,٬،\s]/g, "");
}

/** "2.5" with scale 3 = 2500; null for anything that is not a plain non-negative decimal with at most `scale` decimals. */
export function parseScaled(input: string, scale: number): number | null {
  const s = asciiNumber(input);
  const m = /^(\d{1,12})(?:\.(\d{1,9}))?$/.exec(s);
  if (!m || (m[2]?.length ?? 0) > scale) return null;
  const n = Number(m[1]) * 10 ** scale + Number((m[2] ?? "").padEnd(scale, "0") || 0);
  return Number.isSafeInteger(n) ? n : null;
}

export type BuiltLink = { ok: true; input: PriceLinkInput } | { ok: false; error: string };

export function buildLinkInput(f: LinkForm): BuiltLink {
  const bad = (error: string): BuiltLink => ({ ok: false, error });
  const rounding = f.rounding;
  let raw: unknown;
  if (f.basis === "toman") {
    const t = parseScaled(f.toman, 0);
    if (t === null || t < 1) return bad("قیمت امروز را به تومان و به‌صورت عدد صحیح وارد کنید.");
    raw = { kind: f.kind, fromToman: t, roundingToman: rounding };
  } else if (f.kind === "USD") {
    const cents = parseScaled(f.usd, 2);
    if (cents === null || cents < 1) return bad("مبلغ دلاری را وارد کنید (حداکثر دو رقم اعشار).");
    raw = { kind: "USD", usdCents: cents, roundingToman: rounding };
  } else {
    const mg = parseScaled(f.grams, 3);
    const wage = parseScaled(f.wage || "0", 2);
    const profit = parseScaled(f.profit || "0", 2);
    const tax = parseScaled(f.tax || "0", 2);
    const stone = parseScaled(f.stone || "0", 0);
    if (mg === null || mg < 1) return bad("وزن طلا را به گرم وارد کنید (حداکثر سه رقم اعشار).");
    if (wage === null || profit === null || tax === null) return bad("اجرت، سود و مالیات را به درصد وارد کنید (حداکثر دو رقم اعشار).");
    if (stone === null) return bad("هزینهٔ سنگ را به تومان و به‌صورت عدد صحیح وارد کنید.");
    raw = { kind: "GOLD", weightMg: mg, wageBp: wage, profitBp: profit, taxBp: tax, stoneToman: stone, roundingToman: rounding };
  }
  const r = priceLinkInputSchema.safeParse(raw);
  if (!r.success) return bad(r.error.issues[0]?.message ?? "مقادیر واردشده معتبر نیست.");
  return { ok: true, input: r.data };
}

export type Preview = { ok: true; price: number; rateToman: number; appliedAt: string } | { ok: false; reason: "no_rate" | "out_of_range" };

/** The price this input gives at today's rate, exactly as the API will compute it. */
export function previewPrice(input: PriceLinkInput, rates: CurrentRates): Preview {
  const rate = rates[input.kind === "USD" ? "USD" : "GOLD18"];
  if (!rate) return { ok: false, reason: "no_rate" };
  const link = linkFromInput(input, rate.rateToman);
  if (!link) return { ok: false, reason: "out_of_range" };
  const p = priceOf(link, rate.rateToman);
  return p.ok ? { ok: true, price: p.priceToman, rateToman: rate.rateToman, appliedAt: rate.appliedAt } : { ok: false, reason: "out_of_range" };
}

const fmt = (n: number, scale: number): string => {
  const whole = Math.floor(n / 10 ** scale);
  const frac = String(n % 10 ** scale).padStart(scale, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
};

/** A stored link back into the form (to edit it): the native fields filled, today's-price field left empty. */
export function formFromLink(l: PriceLinkView): LinkForm {
  const rounding = (ROUNDING_STEPS as readonly number[]).includes(l.roundingToman) ? l.roundingToman : 1000;
  if (l.kind === "USD") return { ...EMPTY_LINK_FORM, kind: "USD", basis: "native", usd: fmt(l.usdCents ?? 0, 2), rounding };
  return { ...EMPTY_LINK_FORM, kind: "GOLD", basis: "native", grams: fmt(l.weightMg ?? 0, 3), wage: fmt(l.wageBp, 2), profit: fmt(l.profitBp, 2), tax: fmt(l.taxBp, 2), stone: String(l.stoneToman), rounding };
}
