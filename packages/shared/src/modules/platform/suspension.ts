import { z } from "zod";
import { normalizeFaText } from "../../lib/text.js";

/** ADR 0003 (G2): platform store suspension. Reasons mirror the database enum `SuspensionReason`. */
export const SUSPENSION_REASONS = [
  "FRAUD",
  "PROHIBITED_GOODS",
  "PHISHING_OR_IMPERSONATION",
  "LEGAL_ORDER",
  "PAYMENT_PROVIDER_REQUEST",
  "CUSTOMER_COMPLAINTS",
  "SECURITY_INCIDENT",
  "OTHER",
] as const;
export type SuspensionReason = (typeof SUSPENSION_REASONS)[number];

export const SUSPENSION_REASON_LABELS: Readonly<Record<SuspensionReason, string>> = {
  FRAUD: "کلاهبرداری",
  PROHIBITED_GOODS: "کالای ممنوع",
  PHISHING_OR_IMPERSONATION: "فیشینگ یا جعل هویت",
  LEGAL_ORDER: "دستور قانونی",
  PAYMENT_PROVIDER_REQUEST: "درخواست درگاه پرداخت",
  CUSTOMER_COMPLAINTS: "شکایت مشتریان",
  SECURITY_INCIDENT: "رخداد امنیتی",
  OTHER: "سایر",
};

const text = (max: number, required: string | null) => {
  const base = z.string({ error: required ?? "متن نامعتبر است" }).max(max * 2).transform(normalizeFaText).pipe(z.string().max(max, `حداکثر ${max} نویسه`));
  return required ? base.pipe(z.string().min(1, required)) : base;
};

/** What a platform admin sends to suspend a store (or to amend the open suspension). */
export const suspendStoreSchema = z
  .object({
    reason: z.enum(SUSPENSION_REASONS, { error: "دلیل تعلیق را انتخاب کنید" }),
    /** Shown to the store's owner and staff (never to shoppers). */
    publicMessage: text(300, "پیام قابل نمایش به فروشنده را بنویسید"),
    /** Platform admins only. */
    internalNote: text(2000, null).optional().default(""),
  })
  .strict();
export type SuspendStoreInput = z.infer<typeof suspendStoreSchema>;

export const restoreStoreSchema = z.object({ note: text(2000, "یادداشت رفع تعلیق را بنویسید") }).strict();
