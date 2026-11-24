import { z } from "zod";
import { digitsToAscii, normalizeFaText } from "../../lib/text.js";

/**
 * Card-to-card payment (D35b-1). Pure: shared by the API (rules) and the storefront/dashboard (forms, labels).
 *
 * The store lists its bank cards; a CARD_TRANSFER order waits AWAITING_PAYMENT (stock held) for 24 hours; the shopper transfers the exact
 * amount and submits a receipt (image + bank tracking number + last 4 digits of the paying card); the merchant checks it against the bank
 * statement and approves (order PLACED) or rejects it with a reason (the shopper may submit a corrected one).
 */

/** How long a card-to-card order waits for its receipt (stock held meanwhile). */
export const CARD_TRANSFER_WINDOW_HOURS = 24;
/** After a rejection, the shopper gets at least this long again to send a corrected receipt. */
export const RESUBMIT_WINDOW_HOURS = 24;
export const MAX_BANK_CARDS = 5;
export const MAX_RECEIPTS_PER_ORDER = 5;

export const RECEIPT_STATUSES = ["SUBMITTED", "APPROVED", "REJECTED"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];
export const RECEIPT_STATUS_LABELS: Readonly<Record<ReceiptStatus, string>> = {
  SUBMITTED: "در انتظار بررسی فروشگاه",
  APPROVED: "تأییدشده",
  REJECTED: "ردشده",
};

/** Luhn check (every Iranian bank card number passes it). */
export function luhnValid(digits: string): boolean {
  if (!/^\d{16}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let d = digits.charCodeAt(15 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Card number prefixes of the main Iranian banks (a hint for the bank name; the merchant may type another). */
const BANK_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["603799", "بانک ملی ایران"], ["589210", "بانک سپه"], ["627961", "بانک صنعت و معدن"], ["603770", "بانک کشاورزی"],
  ["628023", "بانک مسکن"], ["627760", "پست بانک"], ["502908", "بانک توسعه تعاون"], ["627412", "بانک اقتصاد نوین"],
  ["622106", "بانک پارسیان"], ["502229", "بانک پاسارگاد"], ["627488", "بانک کارآفرین"], ["621986", "بانک سامان"],
  ["639346", "بانک سینا"], ["639607", "بانک سرمایه"], ["636214", "بانک آینده"], ["502806", "بانک شهر"],
  ["502938", "بانک دی"], ["603769", "بانک صادرات"], ["610433", "بانک ملت"], ["627353", "بانک تجارت"],
  ["589463", "بانک رفاه"], ["505785", "بانک ایران زمین"], ["606373", "بانک قرض‌الحسنه مهر ایران"], ["627648", "بانک توسعه صادرات"],
  ["207177", "بانک توسعه صادرات"], ["505416", "بانک گردشگری"], ["636795", "بانک مرکزی"], ["504172", "بانک قرض‌الحسنه رسالت"],
  ["505801", "مؤسسه کوثر"], ["606256", "مؤسسه ملل"], ["507677", "مؤسسه نور"], ["585983", "بانک تجارت"], ["991975", "بانک ملت"],
];
export function bankOf(cardNumber: string): string | null {
  const d = digitsToAscii(cardNumber).replace(/\D/g, "");
  return BANK_PREFIXES.find(([p]) => d.startsWith(p))?.[1] ?? null;
}

/** "6037991234567890" -> "6037-9912-3456-7890" (left to right; shown in an LTR span). */
export const formatCardNumber = (d: string) => d.replace(/(\d{4})(?=\d)/g, "$1-");

const cardNumber = z
  .string({ error: "شماره کارت را وارد کنید" })
  .transform((v) => digitsToAscii(v).replace(/[\s-]/g, ""))
  .refine((v) => /^\d{16}$/.test(v), "شماره کارت باید ۱۶ رقم باشد")
  .refine(luhnValid, "شماره کارت معتبر نیست؛ دوباره بررسی کنید");

export const bankCardInputSchema = z
  .object({
    cardNumber,
    holderName: z.string({ error: "نام صاحب کارت را وارد کنید" }).transform(normalizeFaText).pipe(z.string().min(2, "نام صاحب کارت را وارد کنید").max(60, "نام صاحب کارت حداکثر ۶۰ نویسه")),
    bankName: z.string().optional().default("").transform(normalizeFaText).pipe(z.string().max(40, "نام بانک حداکثر ۴۰ نویسه")),
  })
  .strict()
  .transform((c) => ({ ...c, bankName: c.bankName || bankOf(c.cardNumber) || "" }));
export type BankCardInput = z.output<typeof bankCardInputSchema>;

export const replaceBankCardsSchema = z
  .object({ cards: z.array(bankCardInputSchema).max(MAX_BANK_CARDS, `حداکثر ${MAX_BANK_CARDS} کارت`) })
  .strict()
  .refine((v) => new Set(v.cards.map((c) => c.cardNumber)).size === v.cards.length, { message: "یک شماره کارت دو بار آمده است", path: ["cards"] });

/** The text fields that come with a receipt image (in the query string; the image is the raw body). */
export const receiptFieldsSchema = z.object({
  trackingCode: z
    .string({ error: "شماره‌ی پیگیری را وارد کنید" })
    .transform((v) => digitsToAscii(v).replace(/[\s-]/g, ""))
    .refine((v) => /^[0-9A-Za-z]{4,30}$/.test(v), "شماره‌ی پیگیری/ارجاع بانکی را درست وارد کنید (۴ تا ۳۰ رقم یا حرف)"),
  payerCardLast4: z
    .string({ error: "۴ رقم آخر کارت پرداخت‌کننده را وارد کنید" })
    .transform((v) => digitsToAscii(v).trim())
    .refine((v) => /^\d{4}$/.test(v), "۴ رقم آخر کارتی که با آن پرداخت کردید را وارد کنید"),
});

export const reviewReceiptSchema = z
  .object({
    decision: z.enum(["approve", "reject"], { error: "تأیید یا رد را انتخاب کنید" }),
    reason: z.string().optional().default("").transform(normalizeFaText).pipe(z.string().max(300, "دلیل حداکثر ۳۰۰ نویسه")),
  })
  .strict()
  .refine((v) => v.decision === "approve" || v.reason.length >= 3, { message: "دلیل رد را برای خریدار بنویسید", path: ["reason"] });
