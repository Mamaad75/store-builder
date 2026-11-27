import { z } from "zod";
import { MAX_PRICE_TOMAN } from "../../lib/money.js";
import { cleanText } from "../../lib/clean-text.js";
import { digitsToAscii } from "../../lib/text.js";

/**
 * The platform's own money rules for a store: subscription plans, the store's wallet (gift credit) and the referral programme.
 * Pure integer arithmetic in Toman (never floats); the API applies it inside one transaction under the wallet row's lock.
 * No payment gateway exists yet: a purchase is recorded by platform staff after they received the money (see docs/commerce.md).
 */

/** An invited store gets this percentage off its first purchase; the inviter gets this percentage of that purchase as wallet credit. */
export const REFERRAL_PERCENT = 10;
/** Most credit a wallet can hold, and the largest single manual adjustment: keeps every number far from the database's integer limit. */
export const MAX_WALLET_TOMAN = 2_000_000_000;
export const MAX_ADJUST_TOMAN = 1_000_000_000;
export const MAX_PLANS = 20;

/** Whole Toman, rounded down (a fraction of a Toman never becomes credit). */
export const percentOf = (amount: number, percent: number): number => Math.floor((amount * percent) / 100);

const name = z.string().transform(cleanText).pipe(z.string().min(2, "نام پلن را بنویسید (حداقل ۲ حرف).").max(60, "نام پلن حداکثر ۶۰ حرف باشد."));
const description = z.string().transform(cleanText).pipe(z.string().max(300, "توضیح پلن حداکثر ۳۰۰ حرف باشد."));
export const planInputSchema = z
  .object({
    name,
    description: description.default(""),
    priceToman: z.number({ error: "قیمت را به تومان و عدد صحیح بنویسید." }).int("قیمت را به تومان و عدد صحیح بنویسید.").min(0, "قیمت نمی‌تواند منفی باشد.").max(MAX_PRICE_TOMAN, "قیمت بیش از حد بزرگ است."),
    durationDays: z.number({ error: "مدت را به روز بنویسید." }).int("مدت را به روز بنویسید.").min(1, "مدت دست‌کم یک روز است.").max(3660, "مدت بیش از ده سال نمی‌شود."),
    active: z.boolean().default(true),
  })
  .strict();
export type PlanInput = z.infer<typeof planInputSchema>;

export const purchaseInputSchema = z.object({ planId: z.string().min(1).max(64), useWallet: z.boolean().default(false), note: z.string().transform(cleanText).pipe(z.string().max(200, "یادداشت حداکثر ۲۰۰ حرف باشد.")).default("") }).strict();
export const walletAdjustSchema = z
  .object({
    amountToman: z.number({ error: "مبلغ را به تومان و عدد صحیح بنویسید." }).int("مبلغ را به تومان و عدد صحیح بنویسید.").min(-MAX_ADJUST_TOMAN).max(MAX_ADJUST_TOMAN).refine((n) => n !== 0, "مبلغ نباید صفر باشد."),
    reason: z.string().transform(cleanText).pipe(z.string().min(3, "دلیل را بنویسید (حداقل ۳ حرف).").max(200, "دلیل حداکثر ۲۰۰ حرف باشد.")),
  })
  .strict();
export const redeemReferralSchema = z.object({ code: z.string().max(40) }).strict();

// ---- referral codes ----

/** No I, O, 0 or 1: a code read aloud or typed from a screenshot cannot be confused. */
export const REFERRAL_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_CODE_RE = new RegExp(`^[${REFERRAL_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

/** A code from random bytes (one per character; `bytes.length` >= REFERRAL_CODE_LENGTH). Bytes above the largest multiple are skipped by the caller's retry. */
export function referralCodeFrom(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) out += REFERRAL_ALPHABET[(bytes[i] ?? 0) % REFERRAL_ALPHABET.length];
  return out;
}
/** What a person typed (Persian digits, lower case, spaces or dashes) as the canonical code, or null when it cannot be one. */
export function normalizeReferralCode(input: string): string | null {
  const c = digitsToAscii(input).toUpperCase().replace(/[\s\-_]/g, "");
  return REFERRAL_CODE_RE.test(c) ? c : null;
}

// ---- the price of a purchase ----

export interface PurchaseQuote {
  /** The plan's price. */
  price: number;
  /** Referral discount (invited store, first paid purchase). */
  discount: number;
  /** After the discount: what the purchase costs. */
  due: number;
  /** Paid from the wallet (never more than the balance or what is due). */
  walletUsed: number;
  /** Received in cash (due minus the wallet). */
  cash: number;
  /** Credit for the inviter: a share of `due`; 0 when nothing is paid or the store was not invited. */
  reward: number;
}

/**
 * The money of one subscription purchase. A free plan (price 0) never uses up an invitation and pays no reward: only a paid first purchase does.
 * The reward is a share of what the purchase costs (after the invited store's discount), whether it was paid in cash or from the wallet.
 */
export function quotePurchase(i: { price: number; invited: boolean; walletBalance: number; useWallet: boolean }): PurchaseQuote {
  const price = Math.max(0, Math.floor(i.price));
  const qualifies = i.invited && price > 0;
  const discount = qualifies ? percentOf(price, REFERRAL_PERCENT) : 0;
  const due = price - discount;
  const walletUsed = i.useWallet ? Math.min(Math.max(0, Math.floor(i.walletBalance)), due) : 0;
  return { price, discount, due, walletUsed, cash: due - walletUsed, reward: qualifies ? percentOf(due, REFERRAL_PERCENT) : 0 };
}

// ---- the subscription period ----

const DAY_MS = 86_400_000;
/** A purchase extends from the end of a period still running, otherwise starts now (nothing is lost by buying early). */
export function nextPeriod(currentEnd: Date | null, now: Date, days: number): { startsAt: Date; endsAt: Date } {
  const startsAt = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  return { startsAt, endsAt: new Date(startsAt.getTime() + days * DAY_MS) };
}

export type SubscriptionState = { kind: "none" } | { kind: "active"; daysLeft: number } | { kind: "expired" };
export function subscriptionState(endsAt: Date | null, now: Date): SubscriptionState {
  if (!endsAt) return { kind: "none" };
  const left = endsAt.getTime() - now.getTime();
  return left > 0 ? { kind: "active", daysLeft: Math.ceil(left / DAY_MS) } : { kind: "expired" };
}

export const WALLET_ENTRY_KINDS = ["REFERRAL_REWARD", "PURCHASE", "ADMIN_ADJUST"] as const;
export type WalletEntryKind = (typeof WALLET_ENTRY_KINDS)[number];
export const WALLET_KIND_LABELS: Readonly<Record<WalletEntryKind, string>> = { REFERRAL_REWARD: "هدیهٔ دعوت از دوستان", PURCHASE: "پرداخت بخشی از اشتراک", ADMIN_ADJUST: "تنظیم توسط پشتیبانی" };
